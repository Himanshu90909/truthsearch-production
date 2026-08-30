# TruthSearch provider registry

TruthSearch uses one adapter interface for public information sources. The research engine asks the registry for providers based on inferred intent; it does not embed provider-specific logic in the planner. Adapters return normalized metadata and the existing fetch, deduplication, retrieval, evidence, and citation pipeline remains the trust boundary.

| Provider | Category | Access | Configuration | Capabilities | Notes |
|---|---|---|---|---|---|
| Wikipedia | Open knowledge | Public MediaWiki API | None | Search and public article discovery | Use the API and retain the original article URL. |
| arXiv | Academic | Public Atom API | None | Titles, abstracts, authors, dates, paper URLs | Metadata/abstract discovery; do not copy restricted full text. |
| OpenAlex | Academic | Public API | Optional mailto for polite access | Scholarly metadata and abstract discovery | Use DOI/work URLs and respect service guidance. |
| Europe PMC | Academic | Public REST API | None | Biomedical metadata and abstracts | Prefer metadata and open-access links. |
| Crossref | Academic | Public REST API | Optional contact email | DOI and scholarly metadata | Do not infer peer-review quality from metadata alone. |
| GitHub | Programming | Public REST API | Optional `GITHUB_TOKEN` | Repository discovery, language, stars, update date | GitHub documents 60 requests/hour unauthenticated and 5,000/hour authenticated; search endpoints can be stricter. [1] |
| Stack Exchange | Programming | Public API | None | Stack Overflow question discovery and metadata | Honor `quota_max`, `quota_remaining`, backoff, and API limits. |
| Open Library | Books | Public APIs | None | Book metadata, subjects, authors, ISBN | Metadata only; do not copy copyrighted books. [2] |
| Wikidata | Open knowledge | Public Wikibase API | None | Entity search and identifiers | Keep Wikidata URL and treat statements as evidence requiring context. [3] |
| World Bank | Government/open data | Public Indicators API | None | Indicator metadata and country/economic discovery | Use for discovery and link to indicator pages. [4] |
| Data.gov | Datasets | API key required | `DATA_GOV_API_KEY` | Federal dataset catalog metadata | Disabled without a user-provided key; no placeholder key is used. [5] |
| YouTube | Video | Official Data API | `YOUTUBE_API_KEY` | Video metadata | Optional adapter only; transcripts require separately permitted access. [6] |
| Brave/Tavily | Web | Licensed/paid API | Provider key and `ENABLE_PAID_SEARCH=true` | General web search | Explicit opt-in only; missing keys produce a visible unavailable status. |

## Intent routing

The router currently recognizes programming, documentation, books, datasets, government, academic research, education, and general research intents. Programming and documentation questions add GitHub and Stack Exchange; book questions add Open Library; dataset questions add Data.gov and World Bank; government questions add World Bank and Data.gov; general questions add Wikidata. Academic sources remain part of the bounded plan for every research question so the system can compare general knowledge with scholarly evidence.

## Failure and safety policy

A provider is not considered available merely because its name exists in code. Keyed providers are disabled when their required secret is missing. Public providers may still be throttled or unavailable, so each search is isolated with timeouts and `Promise.allSettled`; successful sources continue through normalization while failures are recorded in the research trail. The application never bypasses authentication, paywalls, CAPTCHAs, robots/access controls, rate limits, or terms of service, and never fabricates an API response, citation, URL, paper, or metric.

## References

[1]: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api "GitHub REST API rate limits"
[2]: https://openlibrary.org/developers/api "Open Library APIs"
[3]: https://www.wikidata.org/wiki/Wikidata:REST_API "Wikidata REST API"
[4]: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation "World Bank Indicators API"
[5]: https://resources.data.gov/catalog-api/ "Data.gov Catalog API"
[6]: https://developers.google.com/youtube/v3/docs "YouTube Data API Reference"
