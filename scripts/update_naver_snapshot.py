#!/usr/bin/env python3
"""Work 브라우저가 읽은 공식 상품 카드를 검증해 네이버 전용 스냅샷으로 저장한다."""
import argparse
import json
import os
import tempfile
from datetime import datetime

from collect_discounts import (KST, NAVER_SNAPSHOT, NAVER_SNAPSHOT_FUTURE_TOLERANCE,
                               NAVER_SNAPSHOT_MAX_AGE, merge_naver_row,
                               parse_naver_card, parse_snapshot_time)


def build_snapshot(payload, now=None):
    if not isinstance(payload, dict) or payload.get("source") != "work-browser":
        raise RuntimeError("Work 입력 source는 work-browser여야 함")
    observed_at = parse_snapshot_time(payload.get("observedAt"))
    current = (now or datetime.now(KST)).astimezone(KST)
    age = current - observed_at
    if age < -NAVER_SNAPSHOT_FUTURE_TOLERANCE:
        raise RuntimeError("Work 확인 시각이 미래임")
    if age > NAVER_SNAPSHOT_MAX_AGE:
        raise RuntimeError("Work 입력이 이미 18시간보다 오래됨")

    cards = payload.get("cards")
    if not isinstance(cards, list) or not cards:
        raise RuntimeError("Work 상품 카드가 비어 있음")
    rows_by_id, conflicts = {}, set()
    for card in cards:
        if not isinstance(card, dict):
            raise RuntimeError("Work 상품 카드 형식이 잘못됨")
        parsed = parse_naver_card(card)
        if parsed:
            merge_naver_row(rows_by_id, conflicts, parsed)
    if conflicts:
        raise RuntimeError(f"같은 상품번호의 가격 충돌 {len(conflicts)}건")
    if not rows_by_id:
        raise RuntimeError("공개 고정 할인가 상품을 0건 읽음")

    scanned = payload.get("scanned")
    if not isinstance(scanned, int) or isinstance(scanned, bool) or scanned < len(rows_by_id):
        raise RuntimeError("Work 입력 scanned 값이 잘못됨")
    rows = sorted(rows_by_id.values(), key=lambda row: (-row["rate"], row["name"]))
    return {
        "version": 1,
        "source": "work-browser",
        "updatedAt": observed_at.replace(microsecond=0).isoformat(),
        "scanned": scanned,
        "items": rows,
    }


def write_snapshot(snapshot, output_path=NAVER_SNAPSHOT):
    target = os.path.abspath(output_path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=".naver-discounts-", suffix=".tmp",
                                     dir=os.path.dirname(target))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(snapshot, f, ensure_ascii=False, indent=1)
            f.write("\n")
        os.replace(temp_path, target)
    except Exception:
        try:
            os.unlink(temp_path)
        except FileNotFoundError:
            pass
        raise


def main():
    parser = argparse.ArgumentParser(description="Work 네이버 카드 JSON을 안전한 스냅샷으로 변환")
    parser.add_argument("input", help="Work가 만든 원시 카드 JSON 경로")
    parser.add_argument("--output", default=NAVER_SNAPSHOT, help="출력 스냅샷 경로")
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as f:
        payload = json.load(f)
    snapshot = build_snapshot(payload)
    write_snapshot(snapshot, args.output)
    print(f"[ok] naver work snapshot: scanned={snapshot['scanned']} discounted={len(snapshot['items'])}")


if __name__ == "__main__":
    main()
