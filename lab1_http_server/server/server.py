import socket

HOST = "0.0.0.0"
PORT = 8080

def main():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind((HOST, PORT))
        s.listen(1)
        print(f"Serving on http://localhost:{PORT}")
        while True:
            conn, addr = s.accept()
            with conn:
                print(f"Connected by {addr}")
                request = conn.recv(1024).decode("utf-8") # receive the http req
                print(f"Request:\n{request}")

                with open("content/index.html","rb") as f:
                    body = f.read()

                response = b"HTTP/1.1 200 OK\r\n"
                response += b"Content-Type: text/html\r\n"
                response += f"Content-Length: {len(body)}\r\n".encode()
                response += b"Connection: close\r\n\r\n"
                response += body

                conn.sendall(response)

if __name__ == "__main__":
    main()