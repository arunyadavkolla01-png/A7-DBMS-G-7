# TripWise — AI Travel Booking Platform

An AI-Based Smart Travel Experience Personalization and Booking Ecosystem.

## Quick Start

```bash
cp .env.example .env
docker compose up --build -d
docker compose exec backend python -m app.scripts.seed_all