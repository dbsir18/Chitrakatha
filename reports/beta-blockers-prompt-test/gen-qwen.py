import requests, json, base64, sys, pathlib

API_KEY = sys.argv[1]
PROMPT_FILE = pathlib.Path(__file__).parent / "prompt-v2.txt"
OUT_FILE = pathlib.Path(__file__).parent / "qwen-v2.png"

prompt = PROMPT_FILE.read_text().strip()

print("Calling Qwen Image 3 Pro via OpenRouter...")
response = requests.post(
    url="https://openrouter.ai/api/v1/images",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": "https://chitrakatha.app",
        "X-Title": "Chitrakatha",
    },
    data=json.dumps({
        "model": "qwen/qwen-image-3-pro",
        "prompt": prompt,
        "resolution": "2K",
        "aspect_ratio": "16:9",
        "n": 1,
    }),
    timeout=180,
    proxies={"http": None, "https": None},  # bypass macOS system proxy
)

if not response.ok:
    print(f"Error {response.status_code}: {response.text[:500]}")
    sys.exit(1)

result = response.json()
images = result.get("data", [])
if not images:
    print("No images in response:")
    print(json.dumps(result, indent=2)[:600])
    sys.exit(1)

image_bytes = base64.b64decode(images[0]["b64_json"])
OUT_FILE.write_bytes(image_bytes)
print(f"Saved to {OUT_FILE} ({len(image_bytes)//1024} KB)")
