# QR Sal

<!-- impeccable:product-schema 1 -->

## Platform

Web and JavaScript runtimes.

## Stack

Implementation choices delegated. Dependency-free JavaScript QR engine, typed public API, static HTML/CSS/JavaScript demo, GitHub repository and GitHub Pages. PDF.js is a separate demo-only PDF renderer.

## Users and purpose

People scanning QR codes from images and documents; developers integrating a decoder; visitors evaluating Sal's open-source portfolio.

## Capabilities and constraints

QR Model 2 decoding, multiple symbols, image recovery and opt-in diagnostics. Use real pixels and error correction. Never synthesize payloads. This is a QR decoder, not a general 1D barcode decoder. Recovery budgets are cooperative, and decoding is not guaranteed.

## Brand commitments

QR Sal is the public name; Sal identifies the creator. Follow familiar open-source conventions: useful README, installation and API examples, runnable demo, clear license and honest measurements. Prefer a clean, compact interface and short copy.

## Privacy

No credentials, business data, private documents or inherited Git history. Public examples and fixtures must be synthetic. Process selected files locally; no AI service or upload endpoint.

## Evidence

An independently generated synthetic regression suite and aggregate measurements on a public QR benchmark. Corpus measurements describe a development dataset used during tuning, not an unseen accuracy estimate. Do not imply universal accuracy or equal-compute superiority.
