import requests
import os
import subprocess
import tempfile
from urllib.parse import urlparse

# Environment: dev, stg2, prod
ENV = os.getenv("ENV", "dev")

API_KEY = os.getenv("API_KEY", "fedgpt-api-key")
ZEROSHOT_API_URL = os.getenv("API_URL", "https://ent.fedgpt.cc/api/asura/v1/speeches:zero-shot")
PRESIGN_URL = os.getenv(
    "PRESIGN_URL",
    "https://ent.fedgpt.cc/api/asura/v1/transcriptions:presign"
)
UPLOAD_URL = os.getenv("UPLOAD_URL", "https://ent.fedgpt.cc/asset/")

MODEL_ID = os.getenv("MODEL_ID", "tts-general-1.2.2")

# Prod authentication credentials (for ent.fedgpt.cc)
AUTH_KEY = os.getenv("AUTH_KEY", "fedgpt")
AUTH_SECRET = os.getenv("AUTH_SECRET", "")

# Token cache
_cached_token = None


def _is_prod_environment() -> bool:
    """Check if running in production environment based on ENV variable."""
    return ENV == "prod"


def _get_base_url(url: str) -> str:
    """Extract base URL (scheme + host) from a full URL."""
    parsed = urlparse(url)
    return f"{parsed.scheme}://{parsed.netloc}"


def _login_for_token(base_url: str) -> str:
    """Obtain X-Access-Token from prod login API."""
    global _cached_token

    if _cached_token is not None:
        return _cached_token

    login_url = f"{base_url}/api/auth/v2/fedgpt/login"
    payload = {
        "authKey": AUTH_KEY,
        "authSecret": AUTH_SECRET
    }
    headers = {
        "accept": "application/json",
        "Content-Type": "application/json"
    }

    response = requests.post(login_url, headers=headers, json=payload)

    if response.status_code != 200:
        raise Exception(f"Login failed with status code {response.status_code}: {response.text}")

    token = response.json().get("token")
    if not token:
        raise Exception(f"No token in login response: {response.text}")

    _cached_token = token
    return token


def _get_auth_headers(api_url: str) -> dict:
    """Get appropriate auth headers based on ENV variable."""
    if _is_prod_environment():
        base_url = _get_base_url(api_url)
        token = _login_for_token(base_url)
        return {"X-Access-Token": token}
    else:
        return {"X-API-Key": API_KEY}


def clear_token_cache():
    """Clear the cached token (useful if token expires)."""
    global _cached_token
    _cached_token = None

END_SILENCE_TOKEN = "<|sil_200ms|>"


def send_zero_shot_request(
    text: str,
    prompt_voice_text: str,
    prompt_voice_asset_key: str,
    prompt_voice_url: str,
    language: str = None,
    prompt_language: str = None,
    add_end_silence: bool = False,
) -> bytes:
    headers = {
        **_get_auth_headers(ZEROSHOT_API_URL),
        "Content-Type": "application/json"
    }

    if language is not None:
        text = f"<|{language}|>{text}"

    if add_end_silence:
        text = f"{text}{END_SILENCE_TOKEN}"

    if prompt_language is not None:
        prompt_voice_text = f"<|{prompt_language}|>{prompt_voice_text}"

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

    print(payload)

    response = requests.post(ZEROSHOT_API_URL, headers=headers, json=payload)

    if response.status_code == 200:
        return response.content
    print(f"Request failed with status code {response.status_code}: {response.text}")
    raise Exception(f"Request failed with status code {response.status_code}: {response.text}")



def presign(content_type: str) -> tuple[str, dict[str, str]]:

    presign_headers = {
        **_get_auth_headers(PRESIGN_URL),
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

def pad_audio_with_silence(
    input_path: str,
    start_silence_sec: float = 0.0,
    end_silence_sec: float = 0.0,
) -> str:
    """
    Pad audio file with silence at the start and/or end using ffmpeg.

    Args:
        input_path: Path to the input audio file
        start_silence_sec: Duration of silence to add at the start (seconds)
        end_silence_sec: Duration of silence to add at the end (seconds)

    Returns:
        Path to the padded audio file (temporary file if padding applied, original if not)
    """
    if start_silence_sec <= 0.0 and end_silence_sec <= 0.0:
        return input_path

    # Create a temporary file for the padded audio
    suffix = os.path.splitext(input_path)[1]
    temp_fd, temp_path = tempfile.mkstemp(suffix=suffix)
    os.close(temp_fd)

    # Build ffmpeg filter for padding
    filters = []
    if start_silence_sec > 0.0:
        filters.append(f"adelay={int(start_silence_sec * 1000)}|{int(start_silence_sec * 1000)}")
    if end_silence_sec > 0.0:
        filters.append(f"apad=pad_dur={end_silence_sec}")

    filter_str = ",".join(filters)

    cmd = [
        "ffmpeg", "-y",
        "-i", input_path,
        "-af", filter_str,
        temp_path
    ]

    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise Exception(f"ffmpeg padding failed: {result.stderr}")

    return temp_path


def upload_prompt_voice(
    file_path: str,
    start_silence_sec: float = 0.0,
    end_silence_sec: float = 0.0,
) -> str:
    """
    Upload prompt voice file with optional silence padding.

    Args:
        file_path: Path to the prompt voice audio file
        start_silence_sec: Duration of silence to add at the start (seconds)
        end_silence_sec: Duration of silence to add at the end (seconds)

    Returns:
        Asset key for the uploaded file
    """
    # Apply silence padding if needed
    padded_path = pad_audio_with_silence(file_path, start_silence_sec, end_silence_sec)
    is_temp_file = padded_path != file_path

    try:
        content_type = "audio/mpeg"
        asset_key, form_data = presign(content_type)
        file_name = os.path.basename(file_path)

        files=[
            ('file',(file_name,open(padded_path,'rb'), content_type))
        ]

        response = requests.post(UPLOAD_URL, data=form_data, files=files)

        if response.status_code != 204:
            raise Exception(f"Upload request failed with status code {response.status_code}: {response.text}")

        return asset_key
    finally:
        # Clean up temporary file if created
        if is_temp_file and os.path.exists(padded_path):
            os.remove(padded_path)
