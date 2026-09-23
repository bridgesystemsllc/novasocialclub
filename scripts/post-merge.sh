#!/bin/bash
set -e

npm install
node server/migrate.js
