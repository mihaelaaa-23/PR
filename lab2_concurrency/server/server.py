import socket
import os
import threading
import time

HOST = "0.0.0.0"
PORT = 8080
BASE_DIR = os.path.join(os.path.dirname(__file__), "content")
MAX_REQUESTS_PER_SECOND = 5

MIME_TYPES = {
    ".html": "text/html",
    ".png": "image/png",
    ".pdf": "application/pdf",
}


def get_mime_type(filename):
    _, ext = os.path.splitext(filename)
    return MIME_TYPES.get(ext, "application/octet-stream")


def build_response(status, body, content_type="text/html"):
    response = f"HTTP/1.1 {status}\r\n"
    response += f"Content-Type: {content_type}\r\n"
    response += f"Content-Length: {len(body)}\r\n"
    response += "Connection: close\r\n\r\n"
    response = response.encode() + body
    return response


def generate_directory_listing(path, relative_path):
    items = os.listdir(path)
    html = f"<html><head><title>Directory listing for /{relative_path}</title></head><body>"
    html += f"<h2>Directory listing for /{relative_path}</h2><ul>"

    if relative_path:
        parent_path = os.path.dirname(relative_path.rstrip('/'))
        html += f'<li><a href="/{parent_path}">../</a></li>'
    for item in items:
        if item.startswith("."):
            continue
        item_path = os.path.join(path, item)
        display_name = item + '/' if os.path.isdir(item_path) else item
        if relative_path:
            url = f"/{relative_path}/{item}".replace("//", "/")
        else:
            url = f"/{item}"

        html += f'<li><a href="{url}">{display_name}</a></li>'
    html += "</ul></body></html>"
    return html


_ip_window_counters = {}


def _parse_request_line_and_headers(request_data: str):
    lines = request_data.split("\r\n")
    request_line = lines[0] if lines else ""
    headers = {}
    for line in lines[1:]:
        if not line:
            break
        if ":" in line:
            name, value = line.split(":", 1)
            headers[name.strip().lower()] = value.strip()
    return request_line, headers


def _get_effective_client_ip(addr, headers):
    override_ip = headers.get("x-client-ip")
    return override_ip if override_ip else addr[0]


def naive_rate_limit_allow(ip: str) -> bool:
    now_second = int(time.time())
    record = _ip_window_counters.get(ip)
    if not record or record[0] != now_second:
        _ip_window_counters[ip] = (now_second, 0)
        record = _ip_window_counters[ip]
    current_count = record[1]
    if current_count >= MAX_REQUESTS_PER_SECOND:
        return False
    time.sleep(0.01)
    _ip_window_counters[ip] = (now_second, current_count + 1)
    return True


def handle_client(conn: socket.socket, addr):
    try:
        request = conn.recv(1024).decode("utf-8", errors="ignore")
        if not request:
            return
        request_line, headers = _parse_request_line_and_headers(request)
        parts = request_line.split(" ")
        if len(parts) < 2:
            body = "<h1>400 Bad Request</h1>".encode()
            conn.sendall(build_response("400 Bad Request", body))
            return

        path = parts[1]
        relative_path = path.lstrip("/")
        filepath = os.path.join(BASE_DIR, relative_path)

        client_ip = _get_effective_client_ip(addr, headers)
        allowed = naive_rate_limit_allow(client_ip)
        if not allowed:
            body = f"<h1>429 Too Many Requests</h1><p>IP {client_ip}</p>".encode()
            conn.sendall(build_response("429 Too Many Requests", body))
            return

        if os.path.exists(filepath):
            if os.path.isfile(filepath):
                _, ext = os.path.splitext(filepath)
                if ext in MIME_TYPES:
                    with open(filepath, "rb") as f:
                        body = f.read()
                    content_type = MIME_TYPES[ext]
                    conn.sendall(build_response("200 OK", body, content_type))
                else:
                    body = "<h1>404 Not Found</h1>".encode()
                    conn.sendall(build_response("404 Not Found", body))
            elif os.path.isdir(filepath):
                listing_html = generate_directory_listing(filepath, relative_path)
                conn.sendall(build_response("200 OK", listing_html.encode(), "text/html"))
        else:
            body = "<h1>404 Not Found</h1>".encode()
            conn.sendall(build_response("404 Not Found", body))
    finally:
        try:
            conn.close()
        except Exception:
            pass


def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((HOST, PORT))
        s.listen(128)
        print(f"Serving on http://localhost:{PORT}")
        while True:
            conn, addr = s.accept()
            t = threading.Thread(target=handle_client, args=(conn, addr), daemon=True)
            t.start()


if __name__ == "__main__":
    main()
