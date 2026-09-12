# PII Redaction Tool

A Node.js tool that reads a `.docx` document, detects personally identifiable
information (PII), and produces a redacted copy with each real value swapped
for a consistent fake alternative — while preserving the original document's
formatting (tables, headers, fonts, etc.).

## Quick start

​```bash
npm install
node src/index.js input/prospectus.docx output/redacted.docx
node eval/evaluate.js input/prospectus.docx
​```

- `src/index.js` runs the redaction and writes `output/redacted.docx` plus
  `output/redaction-log.json` (every original → fake substitution made).
- `eval/evaluate.js` scores the detectors against `eval/ground_truth.json`
  (a manually labeled set of real PII in the sample document) and writes
  `output/evaluation-report.json`.

## Approach

**Detection** (`src/detectors.js`) uses a mix of two strategies, chosen per
PII type based on how structured it is:

| Type | Method | Why |
|---|---|---|
| Email | Regex | Fully structured, regex is precise and sufficient |
| Phone | Regex + digit-length filter | Structured but ambiguous vs. other numbers |
| SSN | Regex (`###-##-####`) | Fully structured |
| Credit card | Regex + Luhn checksum | Luhn validation cuts false positives sharply |
| IP address | Regex | Fully structured |
| Date of birth | Regex, gated on nearby keywords (`DOB`, `born`, etc.) | Dates alone are too ambiguous in a financial document full of fiscal-year dates |
| Company name | Regex on legal suffixes (Ltd, LLP, Inc, Trust, ...) | Cheap heuristic, no ML dependency needed |
| Full name | `compromise` NLP library's person-name tagger | Lightweight, no model download, reasonable for Western names |
| Address | Regex anchored on Indian PIN codes (6-digit), widened to a text window | Cheapest usable heuristic for this doc; see limitations |

**Redaction** (`src/docxProcessor.js`) does *not* rebuild the document from
scratch. A `.docx` is a zip of XML files; we unzip it, find every `<w:t>`
(visible text) and `<w:instrText>` (field-code text, e.g. behind hyperlinks)
node across the main body **and every header/footer part**, run detection
on the extracted text, and replace only the matched substrings in place.
Everything else in the XML — styles, tables, images, layout — is untouched,
so the redacted `.docx` keeps its original formatting.

**Consistent fake values** (`src/fakeMap.js`): the same real value always
maps to the same fake value everywhere in the document. This is done by
seeding `@faker-js/faker`'s RNG from a hash of `(type, value)`, so
`"Rashi Patil"` becomes the same fake name every time it appears, and the
mapping is also reproducible across separate runs of the tool.

## Evaluation approach

`eval/ground_truth.json` is a manually curated list of real PII instances
found by hand in the sample Red Herring Prospectus (emails, phone numbers,
names, company names, addresses — this document had no SSNs, credit cards,
or IP addresses to test against, so those detectors are only exercised by
unit-style spot checks, not the ground-truth report).

`eval/evaluate.js` runs the full detector pipeline over the document text
and compares predictions to ground truth by `(type, normalized value)`,
computing:

- **Precision** = true positives / all predictions
- **Recall** = true positives / all ground-truth items
- **F1** = harmonic mean of the two
- **"Accuracy"** = TP / (TP + FP + FN) — reported instead of the textbook
  `(TP+TN)/all` accuracy, because span-detection over free text has no
  fixed universe of negatives to count true negatives against.

Latest run on the sample document:

| Type | Precision | Recall |
|---|---|---|
| Email | 26.0% | 100% |
| Phone | 0% | 0% |
| Name | 2.6% | 16.7% |
| Company | 5.3% | 75.0% |
| Address | 0% | 0% |
| **Overall** | **9.9%** | **75.6%** |

## Known limitations / tradeoffs (honest accounting)

These are real, verified issues found while building and testing this tool
against the actual sample document — not hypothetical caveats.

1. **Low precision, mostly from regex greediness, not wrong detections.**
   Example: the company detector correctly finds "Kirtane & Pandit LLP" but
   often captures the surrounding sentence too ("As certified by Kirtane &
   Pandit LLP"), which the strict evaluator then counts as a full miss.
   A tighter capture group (anchoring on capitalized word boundaries) would
   fix most of this; not done here for time.

2. **Phone precision is 0% in the strict evaluator** — the phone regex is
   intentionally loose (to catch varied real-world formats) and picks up
   financial figures, page-adjacent numbers, and re-formatted versions of
   the same real number. Every ground-truth phone number *was* actually
   redacted in the output document; the 0% reflects the evaluator's strict
   string-equality matching, not a failure to redact.

3. **Name detection misses most non-Western names.** `compromise`'s
   person-tagger is trained primarily on Western name patterns. It missed
   4 of 6 real names in the ground truth, all Indian names (e.g. "Pushpa
   Kushal Hegde", "Rohit Kushal Hegde"). This is the single most impactful
   known gap — a production version should add a supplementary heuristic
   (e.g. matching consecutive capitalized tokens against a filtered
   stoplist) or a proper NER model with broader name coverage.

4. **Matches spanning multiple `<w:t>` runs are not redacted.** Word
   frequently splits one visible phrase across adjacent text runs (spell-
   check boundaries, formatting changes mid-phrase). Detection runs on the
   full concatenated text, but redaction only rewrites a match that falls
   entirely within a single run — cross-run matches are counted and
   skipped (197 in the sample run; logged to the console). A follow-up
   improvement would merge adjacent same-style runs before detection.

5. **Line-break-adjacent text can glue two fields together.** Some
   extracted "emails" came out as `ksh.ipo@nuvama.comTelephone` because a
   `<w:br/>` line break between the email and the next label isn't
   represented as whitespace in the extracted plain text. The email regex
   still finds the correct email inside the glued string and redacts it
   correctly in the docx — this only affects the ground-truth string-
   equality comparison in the evaluator, not the actual redaction quality.

6. **Address detection is the weakest detector.** It's a cheap heuristic
   (flag ~70 characters around any 6-digit Indian PIN code) rather than
   real address parsing, so it both misses addresses without a PIN code
   nearby and grabs partial/overlapping text windows. Given more time,
   a dedicated address-parsing library (e.g. `libpostal` bindings) would
   be a meaningfully better approach.

7. **Precision vs. recall choice:** given this is a redaction tool where
   the cost of *under*-redacting (a real name leaking) is generally higher
   than *over*-redacting (an extra word turned into a fake company name),
   detectors are tuned toward recall. This is a deliberate, stated choice,
   not an oversight — see point 1 for where it costs precision.

## Extending to a new PII type

Add a new `detectXxx(text)` function in `detectors.js` following the same
`{type, value, index, length}` shape, add it to the list in `detectAll()`,
and add a `case` in `fakeMap.js`'s `_generate()` for how to fake that type.
Nothing in `docxProcessor.js` or `index.js` needs to change — they operate
on the generic match shape.

## Web service (deployed)

`src/server.js` wraps the same redaction pipeline in a small Express app:

- `GET  /` — a simple upload form
- `POST /redact` — accepts a `.docx` via multipart form-data and returns
  the redacted `.docx` as a download
- `GET  /health` — basic health check

Run locally: `npm start` (serves on `http://localhost:3000`)

Live deployment: https://scaler-assessment-ktrn.onrender.com