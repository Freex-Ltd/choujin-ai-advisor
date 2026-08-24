#!/usr/bin/env python3
"""食べログのエリア一覧ページ（rstLst）から店舗情報を抽出してCSVにする。

入力は2通り:
  1) ローカル保存したHTML（推奨） … ブラウザで「名前を付けて保存」したファイルを渡す
  2) --fetch による直接取得    … robots.txt を確認し、許可されている場合のみ実行

使い方:
  python3 collect.py --html "saved/*.html" -o shibuya.csv
  python3 collect.py --fetch "https://tabelog.com/tokyo/A1303/A130301/rstLst/" --pages 20 -o shibuya.csv
"""
from __future__ import annotations

import argparse
import csv
import glob
import re
import sys
import time
import urllib.parse
import urllib.robotparser

from bs4 import BeautifulSoup

UA = "tabelog-shibuya-collector/1.0 (personal research; contact: repo owner)"

FIELDS = [
    "店名", "主ジャンル", "全ジャンル", "エリア", "点数",
    "口コミ数", "保存件数", "夜予算", "昼予算", "URL",
]

# 食べログのマークアップ変更に備え、候補セレクタを順に試す
SEL = {
    "card": ["div.list-rst", "li.list-rst__wrap", "div.list-rst__wrap"],
    "name": ["a.list-rst__rst-name-target", "a.cpy-rst-name", "h3.list-rst__rst-name a"],
    "area_genre": ["span.list-rst__area-genre", "span.cpy-area-genre"],
    "rating": ["span.list-rst__rating-val", "span.c-rating__val", "b.c-rating__val"],
    "reviews": ["em.list-rst__rvw-count-num", "em.cpy-review-count", "span.list-rst__rvw-count-num"],
    "saves": ["em.list-rst__save-count-num", "span.list-rst__save-count-num"],
    "budget": ["span.list-rst__budget-val", "span.cpy-dinner-budget-val"],
}


def pick(node, keys):
    """候補セレクタのうち最初にヒットした要素を返す。"""
    for sel in SEL[keys]:
        found = node.select_one(sel)
        if found is not None:
            return found
    return None


def clean(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def split_area_genre(raw: str) -> tuple[str, list[str]]:
    """'渋谷 / 居酒屋、焼き鳥' -> ('渋谷', ['居酒屋', '焼き鳥'])"""
    raw = clean(raw)
    if not raw:
        return "", []
    area, _, genre_part = raw.partition("/")
    if not genre_part:
        # 区切りが無い場合はジャンルのみとみなす
        area, genre_part = "", raw
    genres = [g.strip() for g in re.split(r"[、,／/]", genre_part) if g.strip()]
    return area.strip(), genres


def parse_page(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")

    cards = []
    for sel in SEL["card"]:
        cards = soup.select(sel)
        if cards:
            break
    if not cards:
        return []

    rows = []
    for card in cards:
        name_el = pick(card, "name")
        if name_el is None:
            continue  # 広告枠などレストラン以外の要素
        name = clean(name_el.get_text())
        if not name:
            continue

        area, genres = split_area_genre(
            pick(card, "area_genre").get_text() if pick(card, "area_genre") else ""
        )

        rating_el = pick(card, "rating")
        rating = ""
        if rating_el:
            m = re.search(r"\d+\.\d+", rating_el.get_text())
            if m:
                rating = m.group(0)  # 未評価は '-' なので空のまま

        def num(key):
            el = pick(card, key)
            if not el:
                return ""
            digits = re.sub(r"[^\d]", "", el.get_text())
            return digits

        # 予算は「夜, 昼」の順に並ぶ
        budgets = []
        for sel in SEL["budget"]:
            budgets = card.select(sel)
            if budgets:
                break
        dinner = clean(budgets[0].get_text()) if len(budgets) > 0 else ""
        lunch = clean(budgets[1].get_text()) if len(budgets) > 1 else ""

        rows.append({
            "店名": name,
            "主ジャンル": genres[0] if genres else "",
            "全ジャンル": "、".join(genres),
            "エリア": area,
            "点数": rating,
            "口コミ数": num("reviews"),
            "保存件数": num("saves"),
            "夜予算": dinner,
            "昼予算": lunch,
            "URL": clean(name_el.get("href", "")),
        })
    return rows


def robots_allows(url: str, ua: str) -> bool:
    parts = urllib.parse.urlsplit(url)
    rp = urllib.robotparser.RobotFileParser()
    rp.set_url(f"{parts.scheme}://{parts.netloc}/robots.txt")
    try:
        rp.read()
    except Exception as exc:
        print(f"robots.txt を読めませんでした ({exc})。安全側に倒して中止します。", file=sys.stderr)
        return False
    return rp.can_fetch(ua, url)


def fetch_pages(base_url: str, pages: int, delay: float) -> list[dict]:
    import urllib.request

    if not robots_allows(base_url, UA):
        print(
            "robots.txt がこのURLの自動取得を許可していません。\n"
            "ブラウザでページを保存し --html モードで読み込んでください。",
            file=sys.stderr,
        )
        sys.exit(2)

    rows = []
    for page in range(1, pages + 1):
        url = base_url.rstrip("/") + f"/{page}/"
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                html = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:
            print(f"[{page}ページ目] 取得失敗: {exc}", file=sys.stderr)
            break
        page_rows = parse_page(html)
        print(f"[{page}ページ目] {len(page_rows)}件", file=sys.stderr)
        if not page_rows:
            break
        rows.extend(page_rows)
        time.sleep(delay)  # サーバ負荷をかけないための待機
    return rows


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--html", help="保存済みHTMLのglobパターン (例: 'saved/*.html')")
    src.add_argument("--fetch", metavar="URL", help="rstLst のベースURLを直接取得")
    ap.add_argument("--pages", type=int, default=20, help="--fetch 時の最大ページ数 (既定: 20)")
    ap.add_argument("--delay", type=float, default=3.0, help="--fetch 時のページ間待機秒 (既定: 3.0)")
    ap.add_argument("-o", "--out", default="shibuya.csv", help="出力CSVパス")
    args = ap.parse_args()

    if args.html:
        paths = sorted(glob.glob(args.html))
        if not paths:
            print(f"HTMLが見つかりません: {args.html}", file=sys.stderr)
            sys.exit(1)
        rows = []
        for path in paths:
            with open(path, encoding="utf-8", errors="replace") as fh:
                page_rows = parse_page(fh.read())
            print(f"{path}: {len(page_rows)}件", file=sys.stderr)
            rows.extend(page_rows)
    else:
        rows = fetch_pages(args.fetch, args.pages, args.delay)

    # 同一店舗がページ間で重複することがあるためURLで一意化
    seen, uniq = set(), []
    for row in rows:
        key = row["URL"] or row["店名"]
        if key in seen:
            continue
        seen.add(key)
        uniq.append(row)

    with open(args.out, "w", encoding="utf-8-sig", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(uniq)

    print(f"\n{len(uniq)}件を {args.out} に書き出しました（重複 {len(rows) - len(uniq)} 件を除外）。")


if __name__ == "__main__":
    main()
