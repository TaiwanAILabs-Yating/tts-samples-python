import requests
import os

API_KEY = os.getenv("API_KEY", "fedgpt-api-key")
ZEROSHOT_API_URL = os.getenv("API_URL", "https://ent.fedgpt.cc/api/asura/v1/speeches:zero-shot")
PRESIGN_URL = os.getenv(
    "PRESIGN_URL",
    "https://ent.fedgpt.cc/api/asura/v1/transcriptions:presign"
)
UPLOAD_URL = os.getenv("UPLOAD_URL", "https://ent.fedgpt.cc/asset/")

MODEL_ID = os.getenv("MODEL_ID", "tts-general-0.0.1")

def send_zero_shot_request(text: str,  prompt_voice_text: str,prompt_voice_asset_key: str, prompt_voice_url: str) -> bytes:
    headers = {
        "X-API-Key":    API_KEY,
        "Content-Type": "application/json"
    }
    
    payload = {
        "input": {
            "text": text,
            "type": "text",
            "promptVoiceUrl": prompt_voice_url,
            "promptVoiceAssetKey": prompt_voice_asset_key,
            "promptText": prompt_voice_text,
        },
        "modelConfig":{
            "model": MODEL_ID,
        },
        "audioConfig": {
            "encoding": "LINEAR16",
        },
    }

    response = requests.post(ZEROSHOT_API_URL, headers=headers, json=payload)

    if response.status_code == 200:
        return response.content
    print(f"Request failed with status code {response.status_code}: {response.text}")
    raise Exception(f"Request failed with status code {response.status_code}: {response.text}")



def presign(content_type: str) -> tuple[str, dict[str, str]]:

    presign_headers = {
        "X-Api-Key": API_KEY,
    }
    presign_payload = {
        "contentType": content_type
    }

    presign_response = requests.post(
        PRESIGN_URL,
        headers=presign_headers,
        json=presign_payload
    )

    if presign_response.status_code != 200:
        raise Exception(f"Presign request failed with status code {presign_response.status_code}: {presign_response.text}")
    

    asset_key = presign_response.json().get("assetKey", "")
    form_data = presign_response.json().get("formData", {})
    print(f"Presigned asset key: {asset_key}")
    return asset_key, form_data

def upload_prompt_voice(file_path: str) -> str:
    content_type = "audio/mpeg"
    asset_key, form_data = presign(content_type)
    file_name = os.path.basename(file_path)

    files=[
        ('file',(file_name,open(file_path,'rb'), content_type))
    ]

    response = requests.post(UPLOAD_URL, data=form_data, files=files)

    if response.status_code != 204:
        raise Exception(f"Upload request failed with status code {response.status_code}: {response.text}")

    return asset_key