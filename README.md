# Personal OS

A personal productivity prototype that brings planning, voice interaction, lightweight automation, and AI-assisted workflows into one browser-based workspace.

## Overview

Personal OS explores how a single interface can reduce the friction between capturing information, planning work, and acting on it. The project is an evolving prototype rather than a production product.

## Problem

Personal workflows are often split across notes, task managers, calendars, assistants, and messaging tools. Moving between them creates repeated setup work and makes context easy to lose.

## Solution

Personal OS combines the core workflow in one web experience, with a lightweight frontend and serverless API routes for selected integrations.

## Key Features

- Voice-assisted interaction
- Personal planning and task workflows
- AI-supported research and drafting
- Installable web app support
- Serverless integrations and scheduled jobs
- Responsive browser-based interface

## Product Decisions

- Keep the primary workflow accessible from one interface
- Use progressive enhancement so core screens remain lightweight
- Treat AI as assistance, not an autonomous source of truth
- Keep credentials in deployment environment variables, never in client code
- Preserve the current root structure because the live deployment depends on it

## Architecture

The project uses a static web frontend with JavaScript modules and serverless API functions. Vercel routing connects the browser experience to backend integrations and scheduled tasks.

## Tech Stack

- HTML, CSS, and JavaScript
- Node.js serverless functions
- Progressive Web App technologies
- Vercel

## Current Status

Active prototype. The core experience is deployed and continues to evolve. Some integrations require private environment configuration and are not available in a fresh local checkout.

## Limitations

- Designed around a personal workflow rather than multi-user collaboration
- Some features depend on third-party services
- Automated outputs require user review
- The repository includes experiments and internal project documentation alongside the main application

## Running Locally

1. Clone the repository.
2. Install dependencies with `npm install`.
3. Create local environment variables from documented placeholders only.
4. Run the project using a Vercel-compatible local environment.

Do not commit local environment files or credentials.

## Security

Secrets are excluded through `.gitignore`. Values used by serverless functions must be configured through deployment environment variables and must never be embedded in client-side code.

## Related Work

The repository currently contains design experiments and planning material for separate projects. Those projects are being reviewed before they are published as independent portfolio repositories.

## Contact

[Roei Klein on GitHub](https://github.com/tklroei1)
