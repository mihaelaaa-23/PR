import requests
import time
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor

# Use different ports for each server
MULTI_THREADED_PORT = 8080
SINGLE_THREADED_PORT = 8081


def make_request(url):
    try:
        start = time.time()
        response = requests.get(url)
        end = time.time()
        return end - start, response.status_code
    except requests.exceptions.ConnectionError:
        return None, None


def test_server(server_type, server_process, port, num_requests=10):
    url = f"http://localhost:{port}/index.html"

    # Give server time to start
    time.sleep(2)

    print(f"\nTesting {server_type} server with {num_requests} concurrent requests to {url}")

    if server_type == "Single-threaded":
        # For single-threaded server, requests are processed one at a time
        start = time.time()
        results = []
        for _ in range(num_requests):
            results.append(make_request(url))
    else:
        # For multi-threaded server, send concurrent requests
        start = time.time()
        with ThreadPoolExecutor(max_workers=num_requests) as executor:
            results = list(executor.map(lambda _: make_request(url), range(num_requests)))

    # Filter out any failed requests
    results = [r for r in results if r[0] is not None]

    if not results:
        print(f"No successful responses received from {server_type} server")
        return

    end = time.time()
    total_time = end - start

    print(f"Total time: {total_time:.2f} seconds")
    print(f"Average response time: {sum(t for t, _ in results) / len(results):.2f} seconds")
    print(f"Successful requests: {sum(1 for _, status in results if status == 200)}/{num_requests}")

    # Stop the server
    server_process.terminate()
    try:
        server_process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        server_process.kill()

    time.sleep(1)


if __name__ == "__main__":
    # Create modified single-threaded server script
    with open("server.py", "r") as f:
        server_code = f.read()

    single_threaded_code = server_code.replace("PORT = 8080", f"PORT = {SINGLE_THREADED_PORT}")
    single_threaded_code = single_threaded_code.replace(
        "thread = threading.Thread(target=handle_client, args=(conn, addr))\n            thread.start()",
        "handle_client(conn, addr)  # Direct call instead of thread"
    )

    with open("single_threaded_server_temp.py", "w") as f:
        f.write(single_threaded_code)

    try:
        # Test the multi-threaded server
        print("Starting multi-threaded server...")
        mt_server = subprocess.Popen([sys.executable, "server.py"])
        test_server("Multi-threaded", mt_server, MULTI_THREADED_PORT)

        # Test the single-threaded server
        print("\nStarting single-threaded server...")
        st_server = subprocess.Popen([sys.executable, "single_threaded_server_temp.py"])
        test_server("Single-threaded", st_server, SINGLE_THREADED_PORT)

        print("\nComparison complete.")
    finally:
        # Clean up temporary file
        import os

        if os.path.exists("single_threaded_server_temp.py"):
            os.remove("single_threaded_server_temp.py")