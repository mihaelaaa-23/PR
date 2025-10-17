import socket
import os
import sys

if len(sys.argv) != 4:
    print("Usage: python client.py server_host server_port filename")
    sys.exit(1)

server_host = sys.argv[1]
server_port = int(sys.argv[2])
filename = sys.argv[3]

SAVE_DIR = "downloads"
os.makedirs(SAVE_DIR, exist_ok=True)

with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
    s.connect((server_host, server_port))

    request = f"GET /{filename} HTTP/1.1\r\nHost: {server_host}\r\nConnection: close\r\n\r\n"
    s.sendall(request.encode())

    response = b""
    while True:
        chunk = s.recv(4096)
        if not chunk:
            break
        response += chunk

header_data, _, body = response.partition(b"\r\n\r\n")
headers = header_data.decode().split("\r\n")
status_line = headers[0]
print("Status:", status_line)

if "200 OK" in status_line:
    ext = os.path.splitext(filename)[1].lower()
    if ext == ".html":
        print("HTML Content:\n", body.decode())
    elif ext in [".png", ".jpg", ".jpeg", ".pdf"]:
        save_path = os.path.join(SAVE_DIR, os.path.basename(filename))
        with open(save_path, "wb") as f:
            f.write(body)
        print(f"{filename} saved to {save_path}")
    else:
        print("Unknown file type, printing as text:")
        print(body.decode(errors='ignore'))