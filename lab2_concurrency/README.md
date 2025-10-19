# Lab 2: Multithreaded HTTP Server

This lab implements a multithreaded HTTP server capable of handling concurrent connections, with added features for request counting and rate limiting.

## Project Structure

![img.png](images/img.png)

## Docker Configuration

### Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY server/ ./server/
COPY client/ ./client/
EXPOSE 8080
CMD ["python", "server/server.py"]
```

### Docker Compose File

```yaml
services:
  server:
    build: .
    ports:
      - "8080:8080"
    command: python server/server.py
```

## Starting the Server

To start the server using Docker make sure you are in the correct directory `lab2_concurrency` and run:

```bash
docker-compose up --build
```

This builds the Docker image and starts the server on port 8080.

## Multithreaded HTTP Server Implementation

The server is implemented using Python's `threading` module to handle multiple client connections concurrently. Each client connection is handled in a separate thread, allowing the server to process multiple requests simultaneously.

### Key Features

- **Multithreaded request handling**: Creates a new thread for each incoming connection
- **MIME type detection**: Serves different file types with appropriate content types
- **Directory listing**: Generates HTML listings of directories with file counts
- **Request counting**: Tracks the number of requests for each resource
- **Rate limiting**: Limits requests from each client IP to prevent abuse

## Concurrency Comparison

### Multithreaded vs. Single-threaded Server

The multithreaded server handles concurrent requests in parallel, while the single-threaded server processes them sequentially. With a simulated processing time of ~1 second per request, the performance difference becomes significant:

| Server Type     | 10 Concurrent Requests | Processing Time | Average Response Time |
|-----------------|------------------------|-----------------|-----------------------|
| Single-threaded | Sequential processing  | ~10.58 seconds  | 5.73 seconds          |
| Multithreaded   | Parallel processing    | ~1.22 seconds   | 1.13 seconds          |

The multithreaded server achieves significantly better throughput by handling multiple requests concurrently, which is essential for real-world web server applications.

## Request Counter Implementation

The request counter tracks how many times each resource has been accessed. This feature demonstrates thread synchronization concepts:

### Naive Implementation (Race Condition)

Initially, the counter was implemented without synchronization:

```python
hit_counter[path] = hit_counter.get(path, 0) + 1
print(f"Thread {threading.current_thread().name}: Reading count for {path}")
current_count = hit_counter[path]
print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
time.sleep(0.1)  # delay to force interleaving
print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")
```

This implementation is vulnerable to race conditions. When multiple threads access the counter simultaneously:
1. Thread A reads the current count (e.g., 5)
2. Thread B reads the current count (also 5)
3. Thread A increments and stores the count (now 6)
4. Thread B increments and stores the count (also 6)
5. The count should be 7, but it's 6 due to the race condition

### Thread-safe Implementation (With Lock)

The thread-safe implementation uses a lock to ensure atomic operations:

```python
with counter_lock:
    hit_counter[path] = hit_counter.get(path, 0) + 1
    print(f"Thread {threading.current_thread().name}: Reading count for {path}")
    current_count = hit_counter[path]
    print(f"Thread {threading.current_thread().name}: Current count is {current_count}")
    time.sleep(0.1)  # delay to force interleaving
    print(f"Thread {threading.current_thread().name}: Updated count to {current_count + 1}")
```

With the lock, only one thread can modify the counter at a time, preventing race conditions.
### Observation

When requesting a directory (/subdir), extra requests are sometimes counted.
This happens because the browser may request additional files inside the folder (like thumbnails or embedded images). Therefore, directory counters may increase by more than one per access.

## Rate Limiting Implementation

The server implements IP-based rate limiting to prevent abuse:

- Each client IP is limited to 10 requests per second
- Requests exceeding the limit receive a 429 Too Many Requests response
- Thread-safe implementation using per-IP locks and a global lock

### Rate Limiting Performance

Testing with two clients:
1. **Spammer Client**: Sends many rapid requests (exceeding rate limit)
2. **Controlled Client**: Sends requests at a controlled rate (below rate limit)

| Client Type | Requests Sent | Successful | Rate Limited | Success Rate | Time  |
|-------------|---------------|------------|--------------|--------------|-------|
| Spammer     | 20            | 7          | 13           | ~50%         | 0.79s |
| Controlled  | 10            | ~10        | 0            | ~100%        | 3.63s |

The rate limiting effectively prevents a single client from overwhelming the server while allowing well-behaved clients to access resources reliably.

### Experimental Observations

- When concurrency is enabled, the shared request_counter and rate_limit dictionaries must be locked to prevent data corruption.
- The controlled client was unaffected by the spammer thanks to independent per-IP rate locks.
- Removing artificial time.sleep() delays resulted in extremely fast tests (e.g., 0.22s) — but such delays are useful for visualizing interleaving.
- Directory requests may count more hits due to multiple sub-resource fetches.
- The concurrent version demonstrates realistic web-server-like behavior where multiple threads process requests simultaneously.

## Conclusion

This multithreaded HTTP server implementation demonstrates several important concepts:
1. Improved performance through concurrent request handling
2. Thread synchronization to prevent race conditions
3. Resource protection through rate limiting

These features make the server more robust and efficient for real-world use cases, handling multiple clients while protecting against abuse.
