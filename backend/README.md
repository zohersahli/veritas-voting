# Veritas Backend

This backend has two responsibilities only:
1) Upload (pin) poll descriptions to IPFS via Pinata and return a CID.
2) (Later) Run a finalizer bot to record finalized results on Ethereum L1.

## Requirements
- Node.js installed

## Setup
Create a local `.env` file (do not commit it):

```env
PORT=5050
FRONTEND_ORIGIN=http://localhost:5173
PINATA_JWT=YOUR_PINATA_JWT
```

## Run
```bash
node server.js
```

## Endpoints

### Health check
- `GET http://localhost:5050/health`

### IPFS pin poll description
- `POST http://localhost:5050/ipfs/pin-poll-description`

Example body:

```json
{
  "groupId": "1",
  "title": "Test",
  "description": "Hello from Veritas"
}
```

## Reference
Pinata pin JSON to IPFS:
- https://docs.pinata.cloud/api-reference/endpoint/ipfs/pin-json-to-ipfs
