import requests
import json

api_key = "dummy"
model = "gemini-1.5-flash"
url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
payload = {
    "contents": [{"parts":[{"text": "Say 'hello'"}]}]
}
print(url)
