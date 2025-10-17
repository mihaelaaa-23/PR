import requests
import time
from concurrent.futures import ThreadPoolExecutor


def make_request(url):
    start = time.time()
    response = requests.get(url)
    end = time.time()
    return end - start, response.status_code


def run_test(num_requests=10):
    # Use a specific file to easily see the hit counter
    url = "http://localhost:8080/index.html"
    start = time.time()

    print(f"Making {num_requests} concurrent requests to {url}")
    with ThreadPoolExecutor(max_workers=num_requests) as executor:
        results = list(executor.map(lambda _: make_request(url), range(num_requests)))

    end = time.time()
    total_time = end - start

    print(f"Total time: {total_time:.2f} seconds")
    print(f"Average response time: {sum(t for t, _ in results) / len(results):.2f} seconds")
    print(f"Successful requests: {sum(1 for _, status in results if status == 200)}/{num_requests}")

    print("\nCheck the web interface at http://localhost:8080/ to see the hit count for index.html")


if __name__ == "__main__":
    run_test()