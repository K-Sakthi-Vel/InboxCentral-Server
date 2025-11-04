# Backend Application

This document provides an overview of the Inbox Central backend application, including its technology stack, API structure, and instructions for local setup and execution.

## Overview

The Inbox Central backend serves as the central hub for managing communication channels, user data, and real-time interactions. It provides a robust API for the frontend application and handles integrations with external services like Twilio.

## Key Technologies

The backend is built using the following technologies:

-   **Node.js & Express.js:** A fast, unopinionated, minimalist web framework for Node.js, providing a robust set of features for web and mobile applications.
-   **Prisma:** A modern database toolkit that simplifies database access with an auto-generated and type-safe query builder.
-   **PostgreSQL (via Prisma):** A powerful, open-source object-relational database system.
-   **Socket.IO:** Enables real-time, bidirectional, and event-based communication between the browser and the server, crucial for instant message updates.
-   **JWT (JSON Web Tokens):** Used for secure authentication and authorization of API requests.
-   **Bcrypt.js:** For hashing passwords securely.
-   **Twilio:** Integration for handling SMS and voice communication.
-   **Passport.js:** Authentication middleware for Node.js, used with strategies like `passport-jwt` and `passport-google-oauth20`.

## Project Structure

The backend project is organized into the following main directories:

-   `prisma/`: Contains the Prisma schema definition and database migration files.
-   `src/lib/`: Utility functions and modules, including database connection (`db.js`), external integrations (`integrations.js`), WebSocket setup (`socket.js`), and Twilio services (`twilio.js`).
-   `src/routes/`: Defines the API endpoints for different functionalities:
    -   `auth.js`: User authentication (login, signup, Google OAuth).
    -   `inbox.js`: Unified inbox management.
    -   `messages.js`: Handling messages across channels.
    -   `notes.js`: Managing user notes.
    -   `settings.js`: User settings and preferences.
    -   `webhooks.js`: Webhook handlers for external services (e.g., Twilio).
-   `src/workers/`: Contains background worker processes, such as `scheduler.js` for scheduled tasks.
-   `server.js`: The main entry point of the application, setting up the Express server and integrating routes and middleware.

## Getting Started

Follow these instructions to get a copy of the project up and running on your local machine for development and testing purposes.

### Prerequisites

Ensure you have the following installed:
-   Node.js (LTS version recommended)
-   npm or yarn (npm is typically installed with Node.js)
-   PostgreSQL database server

### Installation

1.  **Clone the repository:**
    ```bash
    git clone [repository-url]
    cd inbox-central/Backend
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    # or
    yarn install
    ```
3.  **Set up environment variables:**
    Create a `.env` file in the `Backend/` directory based on `.env.example` (if available) and fill in your database connection string, JWT secret, Twilio credentials, and any other necessary environment variables.

    Example `.env` content:
    ```
    DATABASE_URL="postgresql://user:password@localhost:5432/inbox_central_db"
    JWT_SECRET="your_jwt_secret"
    ```

4.  **Run database migrations:**
    ```bash
    npx prisma migrate dev --name init
    ```
    This will create the necessary tables in your PostgreSQL database.

### Running the Development Server

To run the backend application in development mode:

```bash
npm run dev
# or
yarn dev
```

The server will typically run on `http://localhost:5000` (or the port specified in your environment variables).

### Running the Worker

To start the background worker process:

```bash
npm run worker
# or
yarn worker
```

## Features

The Inbox Central backend application provides the following key features:

-   **User Authentication:** Secure registration, login, and session management using JWTs and Passport.js.
-   **Unified Messaging API:** Endpoints for sending and receiving messages across various channels.
-   **Twilio Integration:** Handles incoming and outgoing SMS and voice calls via Twilio webhooks and API.
-   **Real-time Communication:** WebSocket integration for instant message delivery and updates to connected clients.
-   **Contact and Thread Management:** APIs for managing contacts and organizing message threads.
-   **Notes Management:** Functionality to create, retrieve, update, and delete notes associated with contacts or conversations.
-   **Scheduled Tasks:** Background worker for processing scheduled jobs (e.g., sending delayed messages, data synchronization).
-   **Database Management:** Utilizes Prisma for efficient and type-safe interaction with a PostgreSQL database.
-   **Security:** Implements `helmet` for basic security headers and `bcryptjs` for password hashing.
