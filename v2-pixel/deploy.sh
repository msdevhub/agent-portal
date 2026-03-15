#!/bin/bash
# Deploy Research Nexus from git repo
set -e
cd /tmp
rm -rf project-management
git clone https://github.com/bochub/project-management.git
cd project-management
npm install
npx vite build

V2=/home/resley/.openclaw/workspace-research/projects/agent-portal/poc/v2-pixel
rm -rf $V2/public
cp -r dist $V2/public

kill $(lsof -ti:18820) 2>/dev/null || true
sleep 1
cd $V2 && nohup node server.js > /tmp/agent-portal.log 2>&1 &
echo "✅ Research Nexus deployed"
