# Free API selection notes

## OpenAlex
Official documentation: https://help.openalex.org/api/
OpenAlex states that its API is free to start and supports basic queries without a key. It exposes a large scholarly graph of works, authors, sources, institutions, and topics over HTTP. The API can be used as a broad academic metadata and discovery adapter; access budgets and rate limits still need to be respected.

## Europe PMC
Official documentation: https://europepmc.org/RestfulWebService
Europe PMC documents a public REST service for biomedical and life-science literature, with search endpoints and JSON/XML formats. It is a strong domain-specific adapter for medicine, biology, and health research, but its content should not be treated as medical advice and public full text availability varies.

Implementation direction: add OpenAlex and Europe PMC as optional free/public adapters, route science and biomedical questions toward them, retain Wikipedia/arXiv for no-card general coverage, and keep paid providers opt-in only. Provider health, timeouts, rate-limit backoff, and exact source URLs remain mandatory.
