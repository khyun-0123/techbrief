"""TimesFM 「예상 밖 급증」 계산 (11/16) — server/timesfm.js가 부른다.

입력(stdin, JSON): {"series": [{"id": "...", "values": [월별 숫자, 오래된 것부터]}], "window": 24}
출력(stdout, JSON): {"model": "...", "results": [{"id": "...", "points": [{"i": 위치, "lo": 10%, "mid": 50%, "hi": 90%}]}]}

각 달마다 「그 전 달까지의 값만」 넣고 1달 앞을 예측해 예상 범위(10~90%)를 낸다.
실제 값이 90% 상한을 넘었는지는 server/timesfm.js가 판단한다.
구글 BigQuery AI.DETECT_ANOMALIES와 같은 방식 (33 문서 「11/16 TimesFM 시험」).
모델은 서버 안에서만 돈다 (외부로 보내지 않음). 모델 파일은 처음 한 번 Hugging Face에서 받아 둔 것을 쓴다.
"""

import json
import os
import sys

os.environ.setdefault("HF_HUB_OFFLINE", "1")  # 받아 둔 모델만 씀 (매번 인터넷 확인 안 함)

import warnings

warnings.filterwarnings("ignore")

import numpy as np  # noqa: E402
import timesfm  # noqa: E402
import torch  # noqa: E402

torch.set_num_threads(int(os.environ.get("TIMESFM_THREADS", "4")))


def main():
    req = json.load(sys.stdin)
    window = int(req.get("window", 24))
    which = os.environ.get("TIMESFM_MODEL", "3.0")
    results = []
    if which == "2.5":
        model = timesfm.TimesFM_2p5_200M_torch.from_pretrained("google/timesfm-2.5-200m-pytorch")
        model.compile(timesfm.ForecastConfig(max_context=512, max_horizon=16, normalize_inputs=True, use_continuous_quantile_head=True, force_flip_invariance=True, infer_is_positive=True, fix_quantile_crossing=True))
        name = "TimesFM 2.5"
    else:
        model = timesfm.TimesFM3Forecaster.from_pretrained()
        name = "TimesFM 3.0"
    for s in req["series"]:
        values = np.asarray(s["values"], dtype=float)
        start = max(24, len(values) - window)  # 앞에 최소 2년은 있어야 예측
        idx = list(range(start, len(values)))
        if not idx:
            results.append({"id": s["id"], "points": []})
            continue
        ctx = [values[:i] for i in idx]
        points = []
        if which == "2.5":
            _, q = model.forecast(horizon=1, inputs=ctx)
            for i, qq in zip(idx, q):
                points.append({"i": i, "lo": float(qq[0, 1]), "mid": float(qq[0, 5]), "hi": float(qq[0, -1])})
        else:
            for i, out in zip(idx, model.predict_batch(ctx, 1, return_quantiles=True, make_positive=True)):
                qq = out.quantiles
                points.append({"i": i, "lo": float(qq[0, 0]), "mid": float(qq[0, 4]), "hi": float(qq[0, -1])})
        results.append({"id": s["id"], "points": points})
    json.dump({"model": name, "results": results}, sys.stdout)


if __name__ == "__main__":
    main()
