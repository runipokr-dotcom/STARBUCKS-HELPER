#!/usr/bin/env python3
"""STARBUCKS HELPER local MD downloader.

Listens only on 127.0.0.1 and saves extracted product assets below the fixed
Downloads/스타벅스MD directory. Uses only the Python standard library.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import signal
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "127.0.0.1"
PORT = 17832
SAVE_ROOT = Path.home() / "Downloads" / "스타벅스MD"
ALLOWED_ORIGINS = {
    "https://runipokr-dotcom.github.io",
    "http://127.0.0.1:8000",
    "http://localhost:8000",
}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
)
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_IMAGE_BYTES = 30 * 1024 * 1024


class ExtractionError(Exception):
    pass


def validate_product_url(value: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(value.strip())
    except ValueError as exc:
        raise ExtractionError("올바른 URL을 입력해주세요.") from exc
    if parsed.scheme != "https" or parsed.hostname != "www.starbucks.co.kr":
        raise ExtractionError("스타벅스 공식 상품 상세 URL만 사용할 수 있습니다.")
    if parsed.path != "/menu/product_view.do":
        raise ExtractionError("상품 상세페이지 URL 형식이 아닙니다.")
    product_codes = urllib.parse.parse_qs(parsed.query).get("product_cd", [])
    if len(product_codes) != 1 or not re.fullmatch(r"\d+", product_codes[0]):
        raise ExtractionError("URL의 product_cd를 확인해주세요.")
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, parsed.query, ""))


def fetch_bytes(url: str, limit: int, referer: str | None = None) -> tuple[bytes, str]:
    headers = {"User-Agent": USER_AGENT, "Accept-Language": "ko-KR,ko;q=0.9"}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = response.read(limit + 1)
            if len(data) > limit:
                raise ExtractionError("다운로드 파일이 허용 크기를 초과했습니다.")
            return data, response.headers.get_content_type()
    except urllib.error.HTTPError as exc:
        raise ExtractionError(f"스타벅스 서버 응답 오류: HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise ExtractionError("스타벅스 서버에 연결할 수 없습니다.") from exc


def extract_balanced(source: str, marker: str, opener: str, closer: str) -> str:
    marker_index = source.find(marker)
    if marker_index < 0:
        raise ExtractionError("상품 데이터 구조를 찾을 수 없습니다.")
    start = source.find(opener, marker_index + len(marker))
    if start < 0:
        raise ExtractionError("상품 데이터 시작점을 찾을 수 없습니다.")
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(source)):
        char = source[index]
        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    raise ExtractionError("상품 데이터 끝점을 찾을 수 없습니다.")


def parse_product(html: str) -> tuple[str, str, list[str]]:
    try:
        view = json.loads(extract_balanced(html, "view: remapView", "{", "}"))
        files = json.loads(extract_balanced(html, "file: remapFile", "[", "]"))
    except json.JSONDecodeError as exc:
        raise ExtractionError("상품 데이터를 해석할 수 없습니다.") from exc

    name = str(view.get("PRODUCT_NM") or "").strip()
    description = str(view.get("RECOMMEND") or "").replace("\r\n", "\n").strip()
    if not name:
        raise ExtractionError("상품명을 찾을 수 없습니다.")
    if not description:
        raise ExtractionError("하단 상품 설명을 찾을 수 없습니다.")

    ordered = sorted(files, key=lambda item: int(item.get("IMG_ORDER") or 999999))
    image_urls: list[str] = []
    seen: set[str] = set()
    for item in ordered:
        path = str(item.get("FILE_PATH") or "").strip()
        base = str(item.get("IMG_UPLOAD_PATH") or "https://image.istarbucks.co.kr").strip()
        if not path:
            continue
        url = urllib.parse.urljoin(base.rstrip("/") + "/", path.lstrip("/"))
        parsed = urllib.parse.urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname != "image.istarbucks.co.kr":
            continue
        if "/upload/store/skuimg/" not in parsed.path or url in seen:
            continue
        seen.add(url)
        image_urls.append(url)
    if not image_urls:
        raise ExtractionError("상품 원본 이미지를 찾을 수 없습니다.")
    return name, description, image_urls


def safe_folder_name(name: str) -> str:
    cleaned = re.sub(r"[/:*?\"<>|\\\x00-\x1f]", " ", name)
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned[:120] or "이름 없는 상품"


def available_destination(name: str) -> Path:
    SAVE_ROOT.mkdir(parents=True, exist_ok=True)
    base = SAVE_ROOT / safe_folder_name(name)
    if not base.exists():
        return base
    for number in range(2, 10000):
        candidate = SAVE_ROOT / f"{base.name} ({number})"
        if not candidate.exists():
            return candidate
    raise ExtractionError("같은 이름의 상품 폴더가 너무 많습니다.")


def extension_for(url: str, content_type: str) -> str:
    suffix = Path(urllib.parse.unquote(urllib.parse.urlsplit(url).path)).suffix.lower()
    if re.fullmatch(r"\.(?:jpe?g|png|webp|gif|avif)", suffix):
        return ".jpg" if suffix == ".jpeg" else suffix
    guessed = mimetypes.guess_extension(content_type) or ".img"
    return ".jpg" if guessed == ".jpe" else guessed


def extract_product(url: str) -> dict[str, object]:
    normalized_url = validate_product_url(url)
    page_bytes, _ = fetch_bytes(normalized_url, MAX_PAGE_BYTES)
    html = page_bytes.decode("utf-8", errors="replace")
    name, description, image_urls = parse_product(html)
    destination = available_destination(name)
    temporary = Path(tempfile.mkdtemp(prefix=".starbucks-md-", dir=SAVE_ROOT))
    try:
        saved_files: list[str] = []
        for index, image_url in enumerate(image_urls, 1):
            image_bytes, content_type = fetch_bytes(image_url, MAX_IMAGE_BYTES, normalized_url)
            extension = extension_for(image_url, content_type)
            filename = f"{index:02d}{extension}"
            (temporary / filename).write_bytes(image_bytes)
            saved_files.append(filename)
        info = (
            f"상품명\n{name}\n\n"
            f"하단 설명\n{description}\n\n"
            f"원본 URL\n{normalized_url}\n"
        )
        (temporary / "상품정보.txt").write_text(info, encoding="utf-8")
        temporary.rename(destination)
    except Exception:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {
        "productName": name,
        "description": description,
        "imageCount": len(saved_files),
        "files": saved_files + ["상품정보.txt"],
        "folder": str(destination),
        "sourceUrl": normalized_url,
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "StarbucksMDHelper/1.0"

    def log_message(self, format: str, *args: object) -> None:
        print(f"[{self.log_date_time_string()}] {format % args}")

    def allowed_origin(self) -> str | None:
        origin = self.headers.get("Origin")
        return origin if origin in ALLOWED_ORIGINS else None

    def add_cors_headers(self) -> None:
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Private-Network", "true")

    def send_json(self, status: int, payload: dict[str, object]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.add_cors_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:
        if not self.allowed_origin():
            self.send_json(403, {"ok": False, "error": "허용되지 않은 요청입니다."})
            return
        self.send_response(204)
        self.add_cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True, "saveRoot": str(SAVE_ROOT)})
        else:
            self.send_json(404, {"ok": False, "error": "찾을 수 없습니다."})

    def do_POST(self) -> None:
        if self.path != "/extract":
            self.send_json(404, {"ok": False, "error": "찾을 수 없습니다."})
            return
        if not self.allowed_origin():
            self.send_json(403, {"ok": False, "error": "허용되지 않은 요청입니다."})
            return
        try:
            length = int(self.headers.get("Content-Length") or "0")
            if length < 1 or length > 4096:
                raise ExtractionError("요청 크기가 올바르지 않습니다.")
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            result = extract_product(str(payload.get("url") or ""))
            self.send_json(200, {"ok": True, **result})
        except ExtractionError as exc:
            self.send_json(400, {"ok": False, "error": str(exc)})
        except (json.JSONDecodeError, UnicodeDecodeError):
            self.send_json(400, {"ok": False, "error": "요청을 읽을 수 없습니다."})
        except Exception as exc:
            print(f"Unexpected extraction error: {exc!r}")
            self.send_json(500, {"ok": False, "error": "저장 중 오류가 발생했습니다."})


def main() -> None:
    SAVE_ROOT.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    signal.signal(signal.SIGTERM, lambda *_: server.shutdown())
    print(f"STARBUCKS HELPER MD downloader: http://{HOST}:{PORT}")
    print(f"Save root: {SAVE_ROOT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
