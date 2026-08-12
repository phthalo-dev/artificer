`resolveRate(resolved, total)` in `src/report.js` should return
`resolved / total` (or `0` when `total <= 0`). An off-by-one in the
denominator (`total + 1`) depresses the reported resolve rate — fix it.
