import socket
import os

HOST = "0.0.0.0"
PORT = 8080
BASE_DIR = "content"

MIME_TYPES = {
    ".html": "text/html",
    ".png": "image/png",
    ".jpg": "image/jpeg",
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

                if path == "/":
                    path = "/index.html"
                filepath = os.path.join("content", path.lstrip("/"))

                if os.path.isdir(filepath):
                    files = [f for f in os.listdir(filepath) if not f.startswith('.')]  # skip hidden files on macos
                    body = f"<h1>Directory listing for {path}</h1><ul>"
                    for f in files:
                        link = os.path.join(path, f)
                        body += f'<li><a href="{link}">{f}</a></li>'
                    body += "</ul>"

                    response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n" + body
                    conn.sendall(response.encode())
                    conn.close()
                    continue

                if os.path.isfile(filepath):
                    with open(filepath, "rb") as f:
                        body = f.read()
                    mime = get_mime_type(filepath)
                    response = build_response("200 OK", body, mime)
                else:
                    body = b"<h1>404 Not Found</h1>"
                    response = build_response("404 Not Found", body)

                conn.sendall(response)


if __name__ == "__main__":
    main()
