#!/bin/bash
export PATH="/usr/local/bin:$PATH"
cd "$(dirname "$0")"
exec /usr/local/bin/node /usr/local/bin/npm run dev
