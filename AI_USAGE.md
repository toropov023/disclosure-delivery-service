# AI usage

I used OpenAI Codex to help write the sample import (db seed), services, fake provider, API, tests, and documentation.

I guided the project structure, data model, and logic flows. I worked through the schema line by line, considering each field and relationship, the scenarios they needed to support, and how they would be used in the service layer. I used those decisions to direct the implementation, then reviewed and adjusted the generated code. Much of the earlier AI implementation was discarded because it was too complicated or did not fit the design I wanted.

I also refined the delivery and retry behavior, tested requests manually, investigated unexpected results, and chose the scenarios for the demo.

Verification included reviewing behavior against the assignment, running the automated tests and lint/format checks, and using Postman to verify requests.
