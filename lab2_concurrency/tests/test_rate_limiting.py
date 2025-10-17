import requests
import time
import threading


def spam_requests(url, name, num_requests=20):
    successful = 0
    rate_limited = 0

    print(f"Client {name}: Starting {num_requests} rapid requests...")
    start = time.time()

    for i in range(num_requests):
        response = requests.get(url)
        if response.status_code == 200:
            successful += 1
            print(f"Client {name}: Request {i + 1} successful")
        elif response.status_code == 429:
            rate_limited += 1
            print(f"Client {name}: Request {i + 1} rate limited")

    end = time.time()
    print(f"Client {name}: Completed in {end - start:.2f} seconds")
    print(f"Client {name}: Successful: {successful}, Rate limited: {rate_limited}")
    return successful, rate_limited


def controlled_requests(url, name, num_requests=10):
    successful = 0
    rate_limited = 0

    print(f"Client {name}: Starting {num_requests} controlled requests...")
    start = time.time()

    for i in range(num_requests):
        response = requests.get(url)
        if response.status_code == 200:
            successful += 1
            print(f"Client {name}: Request {i + 1} successful")
        elif response.status_code == 429:
            rate_limited += 1
            print(f"Client {name}: Request {i + 1} rate limited")
        time.sleep(0.25)  # Stay below rate limit (4 req/sec < 5 req/sec limit)

    end = time.time()
    print(f"Client {name}: Completed in {end - start:.2f} seconds")
    print(f"Client {name}: Successful: {successful}, Rate limited: {rate_limited}")
    return successful, rate_limited


if __name__ == "__main__":
    # Use specific files to easily track hit counts
    spammer_url = "http://localhost:8080/image.png"
    controlled_url = "http://localhost:8080/index.html"

    print(f"Spammer will request: {spammer_url}")
    print(f"Controlled client will request: {controlled_url}")

    # Run both clients in parallel
    spammer = threading.Thread(target=spam_requests, args=(spammer_url, "Spammer"))
    controlled = threading.Thread(target=controlled_requests, args=(controlled_url, "Controlled"))

    spammer.start()
    controlled.start()

    spammer.join()
    controlled.join()

    print("\nCheck the web interface at http://localhost:8080/ to see hit counts for both files")