# Codec tag cases

`tests/ops/test_codec.cpp` checks the wire codec against a pairwise (strength 2) covering suite over the model below, generated with coverwise. The rows are copied into `kCases` in that file; the expected outcome of each row is computed by the test from the rules it encodes, not stored.

## Model

| Parameter | Values |
|---|---|
| `tag` | `number`, `n`, `u`, `big`, `sym`, `tojson`, `class`, `hy`, `h`, `cb`, `id`, `escaped`, `unknown` |
| `position` | `top`, `element`, `member`, `class_data` |
| `form` | `well_formed`, `bad_payload`, `extra_tag_key`, `user_key` |

- `tag`: the wire value under test. `number` is a plain JSON number, `escaped` a plain object whose user keys begin with `$` (written `$$...`), `unknown` an object with an unregistered `$` key; the rest are the wire tags (`n` is `$n`, `h` is `$h`, and so on).
- `position`: where the value sits — the whole value, an array element, an object member, or a member of `$class` data.
- `form`: `bad_payload` breaks the tag's own payload, `extra_tag_key` adds an unknown `$zz` key, `user_key` adds an escaped user key `$$k`.

Constraints:

- `IF tag = number THEN form = well_formed`
- `IF tag IN {escaped, unknown} THEN form IN {well_formed, user_key}`

Generator input (strength 2, seed 7):

```json
{
  "parameters": [
    {
      "name": "tag",
      "values": [
        "number",
        "n",
        "u",
        "big",
        "sym",
        "tojson",
        "class",
        "hy",
        "h",
        "cb",
        "id",
        "escaped",
        "unknown"
      ]
    },
    {
      "name": "position",
      "values": [
        "top",
        "element",
        "member",
        "class_data"
      ]
    },
    {
      "name": "form",
      "values": [
        "well_formed",
        "bad_payload",
        "extra_tag_key",
        "user_key"
      ]
    }
  ],
  "strength": 2,
  "seed": 7,
  "constraints": [
    "IF tag = number THEN form = well_formed",
    "IF tag IN {escaped, unknown} THEN form IN {well_formed, user_key}"
  ]
}
```

Regenerate with `coverwise generate <model.json>`; the run covered 113/113 pairs in 56 rows.

## Rows

| # | tag | position | form |
|---|---|---|---|
| 0 | `h` | `top` | `bad_payload` |
| 1 | `class` | `top` | `extra_tag_key` |
| 2 | `sym` | `top` | `well_formed` |
| 3 | `cb` | `top` | `user_key` |
| 4 | `id` | `member` | `extra_tag_key` |
| 5 | `cb` | `class_data` | `well_formed` |
| 6 | `number` | `top` | `well_formed` |
| 7 | `class` | `member` | `bad_payload` |
| 8 | `sym` | `element` | `user_key` |
| 9 | `escaped` | `top` | `well_formed` |
| 10 | `hy` | `class_data` | `extra_tag_key` |
| 11 | `big` | `element` | `bad_payload` |
| 12 | `id` | `class_data` | `bad_payload` |
| 13 | `hy` | `top` | `user_key` |
| 14 | `sym` | `class_data` | `extra_tag_key` |
| 15 | `h` | `element` | `extra_tag_key` |
| 16 | `tojson` | `element` | `well_formed` |
| 17 | `escaped` | `member` | `user_key` |
| 18 | `big` | `class_data` | `user_key` |
| 19 | `h` | `member` | `well_formed` |
| 20 | `unknown` | `class_data` | `well_formed` |
| 21 | `u` | `class_data` | `bad_payload` |
| 22 | `h` | `class_data` | `user_key` |
| 23 | `class` | `class_data` | `well_formed` |
| 24 | `n` | `element` | `extra_tag_key` |
| 25 | `tojson` | `member` | `extra_tag_key` |
| 26 | `u` | `top` | `user_key` |
| 27 | `id` | `top` | `user_key` |
| 28 | `big` | `top` | `extra_tag_key` |
| 29 | `tojson` | `class_data` | `user_key` |
| 30 | `unknown` | `top` | `user_key` |
| 31 | `u` | `element` | `extra_tag_key` |
| 32 | `class` | `element` | `user_key` |
| 33 | `cb` | `member` | `extra_tag_key` |
| 34 | `id` | `element` | `extra_tag_key` |
| 35 | `hy` | `member` | `bad_payload` |
| 36 | `cb` | `element` | `bad_payload` |
| 37 | `n` | `class_data` | `user_key` |
| 38 | `n` | `top` | `user_key` |
| 39 | `number` | `member` | `well_formed` |
| 40 | `hy` | `element` | `well_formed` |
| 41 | `number` | `element` | `well_formed` |
| 42 | `tojson` | `top` | `bad_payload` |
| 43 | `escaped` | `class_data` | `user_key` |
| 44 | `big` | `top` | `well_formed` |
| 45 | `n` | `member` | `well_formed` |
| 46 | `id` | `member` | `well_formed` |
| 47 | `sym` | `member` | `extra_tag_key` |
| 48 | `u` | `member` | `well_formed` |
| 49 | `n` | `element` | `bad_payload` |
| 50 | `escaped` | `element` | `well_formed` |
| 51 | `sym` | `element` | `bad_payload` |
| 52 | `number` | `class_data` | `well_formed` |
| 53 | `unknown` | `element` | `well_formed` |
| 54 | `big` | `member` | `extra_tag_key` |
| 55 | `unknown` | `member` | `well_formed` |
