# Free API selection notes

## OpenAlex
Official documentation: https://help.openalex.org/api/
OpenAlex states that its API is free to start and supports basic queries without a key. It exposes a large scholarly graph of works, authors, sources, institutions, and topics over HTTP. The API can be used as a broad academic metadata and discovery adapter; access budgets and rate limits still need to be respected.

## Europe PMC
Official documentation: https://europepmc.org/RestfulWebService
Europe PMC documents a public REST service for biomedical and life-science literature, with search endpoints and JSON/XML formats. It is a strong domain-specific adapter for medicine, biology, and health research, but its content should not be treated as medical advice and public full text availability varies.

Implementation direction: add OpenAlex and Europe PMC as optional free/public adapters, route science and biomedical questions toward them, retain Wikipedia/arXiv for no-card general coverage, and keep paid providers opt-in only. Provider health, timeouts, rate-limit backoff, and exact source URLs remain mandatory.

## GitHub REST API
Official documentation: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
GitHub documents unauthenticated public-data requests at 60 requests per hour and authenticated personal-token requests at 5,000 requests per hour, with stricter limits for some search endpoints. The adapter should use public unauthenticated access by default, honor search-specific limits, and never log tokens.

## Stack Exchange API
Official throttle documentation: https://api.stackexchange.com/docs/throttle
The API documents a public unauthenticated quota that is generally shared by IP/key and a default daily limit of 10,000, plus a dynamic per-method backoff field that clients must honor. It also asks clients not to repeat identical requests more than once per minute. TruthSearch should cap concurrency, cache identical queries, and respect `backoff` when returned.

## Open Library API
Official API documentation: https://openlibrary.org/developers/api
Open Library provides public JSON/YAML/RDF APIs for human-facing book discovery, but explicitly discourages HTML scraping, bulk harvesting, high-traffic backend use, and hundreds of single-book requests. The documented default limit is 1 request/second, or 3 requests/second for identified applications with a User-Agent and contact email. TruthSearch uses search metadata only and should keep its traffic low and cached.
