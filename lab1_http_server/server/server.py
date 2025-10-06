import socket
import os

HOST = "0.0.0.0"
PORT = 8080
BASE_DIR = os.path.join(os.path.dirname(__file__), "content")

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


def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, PORT))
        s.listen(1)
        print(f"Serving on http://localhost:{PORT}")
        while True:
            conn, addr = s.accept()
            with conn:
                print(f"Connected by {addr}")
                request = conn.recv(1024).decode("utf-8")  # receive the http req
                print(f"Request:\n{request}")

                if not request:
                    continue

                path = request.split(" ")[1]
                relative_path = path.lstrip("/")  # remove leading slash
                filepath = os.path.join(BASE_DIR, relative_path)

                if os.path.exists(filepath):
                    if os.path.isfile(filepath):
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
                        listing_html = generate_directory_listing(filepath, relative_path)
                        response = build_response("200 OK", listing_html.encode(), "text/html")
                        conn.sendall(response)
                else:
                    body = "<h1>404 Not Found</h1>".encode()
                    response = build_response("404 Not Found", body)
                    conn.sendall(response)


if __name__ == "__main__":
    main()
