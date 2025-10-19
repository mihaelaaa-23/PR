import socket
import os
import threading
import time

HOST = "0.0.0.0"
PORT = 8080
BASE_DIR = os.path.join(os.path.dirname(__file__), "content")

MIME_TYPES = {
    ".html": "text/html",
    ".png": "image/png",
    ".pdf": "application/pdf",
}

hit_counter = {}
USE_LOCK = False
counter_lock = threading.Lock()

rate_limits = {}
rate_locks = {}
global_lock = threading.Lock()

RATE_LIMIT = 10  # req per s
RATE_WINDOW = 1  # seconds


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


def generate_directory_listing(path, relative_path, client_ip):
    items = os.listdir(path)
    html = f"<html><head><title>Directory listing for /{relative_path}</title></head><body>"
    html += f"<h2>Directory listing for /{relative_path}</h2>"
    html += "<table border='1'><tr><th>File / Directory</th><th>Hits</th></tr>"

    if relative_path:
        parent_path = os.path.dirname(relative_path.rstrip('/'))
        html += f'<tr><td><a href="/{parent_path}">../</a></td><td></td></tr>'

    for item in items:
        if item.startswith("."):
            continue
        item_path = os.path.join(path, item)
        display_name = item + '/' if os.path.isdir(item_path) else item
        if relative_path:
            url = f"/{relative_path}/{item}".replace("//", "/")
        else:
            url = f"/{item}"

        # Get hit count for this file
        hits = hit_counter.get(client_ip, {}).get(url, 0)
        html += f'<tr><td><a href="{url}">{display_name}</a></td><td>{hits}</td></tr>'

    html += "</table>"
    # html += """
    #     <script>
    #     function updateCounter() {
    #         fetch(window.location.href)
    #             .then(response => response.text())
    #             .then(html => {
    #                 document.body.innerHTML = html;
    #             });
    #     }
    #     setInterval(updateCounter, 1000);  // every 1 second
    #     </script>
    #     """

    html += "</body></html>"
    return html


def update_counter(client_ip, path):
    if client_ip not in hit_counter:
        hit_counter[client_ip] = {}
    if path not in hit_counter[client_ip]:
        hit_counter[client_ip][path] = 0
    hit_counter[client_ip][path] += 1


def handle_client(conn, addr):
    client_ip = addr[0]
    if is_rate_limited(client_ip):
        response = build_response("429 Too Many Requests",
                                  b"<h1>429 Too Many Requests</h1><p>Rate limit exceeded. Please try again later.</p>")
        conn.sendall(response)
        return

    with conn:
        print(f"Connected by {addr}")
        request = conn.recv(1024).decode("utf-8")  # receive the http req
        print(f"Request:\n{request}")

        if not request:
            return

        # time.sleep(1)

        path = request.split(" ")[1]
        relative_path = path.lstrip("/")  # remove leading slash
        filepath = os.path.join(BASE_DIR, relative_path)

        update_counter(client_ip, path)

        if os.path.exists(filepath):
            if os.path.isfile(filepath):
                if USE_LOCK:
                    with counter_lock:
                        hit_counter[path] = hit_counter.get(path, 0) + 1
                        print(f"Thread {threading.current_thread().name}: Reading count for {path}")
                        current_count = hit_counter[path]
                        print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
                        time.sleep(0.1)  # delay to force interleaving
                        print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")
                else:
                    hit_counter[path] = hit_counter.get(path, 0) + 1
                    print(f"Thread {threading.current_thread().name}: Reading count for {path}")
                    current_count = hit_counter[path]
                    print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
                    time.sleep(0.1)
                    print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")

                _, ext = os.path.splitext(filepath)
                if ext in MIME_TYPES:
                    with open(filepath, "rb") as f:
                        body = f.read()
                    content_type = MIME_TYPES[ext]
                    response = build_response("200 OK", body, content_type)
                    conn.sendall(response)
                else:
                    body = "<h1>404 Not Found</h1>".encode()
                    response = build_response("404 Not Found", body)
                    conn.sendall(response)
            elif os.path.isdir(filepath):
                if USE_LOCK:
                    with counter_lock:
                        hit_counter[path] = hit_counter.get(path, 0) + 1
                        print(f"Thread {threading.current_thread().name}: Reading count for {path}")
                        current_count = hit_counter[path]
                        print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
                        time.sleep(0.01)
                        print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")
                else:
                    hit_counter[path] = hit_counter.get(path, 0) + 1
                    print(f"Thread {threading.current_thread().name}: Reading count for {path}")
                    current_count = hit_counter[path]
                    print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
                    time.sleep(0.01)
                    print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")

                listing_html = generate_directory_listing(filepath, relative_path, client_ip)
                response = build_response("200 OK", listing_html.encode(), "text/html")
                conn.sendall(response)
        else:
            body = "<h1>404 Not Found</h1>".encode()
            response = build_response("404 Not Found", body)
            conn.sendall(response)


def is_rate_limited(client_ip):
    current_time = time.time()
    with global_lock:
        if client_ip not in rate_limits:
            rate_limits[client_ip] = []
        if client_ip not in rate_locks:
            rate_locks[client_ip] = threading.Lock()
    with rate_locks[client_ip]:  # use per-IP lock
        # remove timestamps older than RATE_WINDOW
        rate_limits[client_ip] = [
            ts for ts in rate_limits[client_ip]
            if current_time - ts < RATE_WINDOW
        ]
        if len(rate_limits[client_ip]) >= RATE_LIMIT:
            return True  # too many requests from this IP
        rate_limits[client_ip].append(current_time)  # else, record this request

        print(f"[{client_ip}] timestamps: {rate_limits[client_ip]}")

        return False


def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, PORT))
        s.listen(5)
        print(f"Serving on http://localhost:{PORT}")
        while True:
            conn, addr = s.accept()
            thread = threading.Thread(target=handle_client, args=(conn, addr))
            thread.start()


if __name__ == "__main__":
    main()
