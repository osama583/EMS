import sys
sys.path.insert(0, '.')
import content_ch5_uat as U
for t in U.TESTERS:
    print(f"  {t['name']:10s} | {t['role']:32s} | has age key: {'age' in t}")
print("plan paragraphs:", len(U.UAT_PLAN), "| discussion paragraphs:", len(U.UAT_DISCUSSION))
print("labels:", [t['label'] for t in U.TESTERS])
