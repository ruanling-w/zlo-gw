# Architecture

This document is generated as a starting map for coding agents. Keep it short and update it when architecture changes.

## Detected Layers

| name | layer | reason |
| --- | --- | --- |
|  | api | has HTTP route definitions |
| bridge | internal | fan-in=0, fan-out=0 |
| channel | internal | fan-in=6, fan-out=12 |
| cli | entry | has entry points, only outbound calls |
| client | core | high fan-in (60 in, 0 out) |
| config | api | has HTTP route definitions |
| gateway | core | high fan-in (24 in, 17 out) |
| io | api | has HTTP route definitions |
| jpg | api | has HTTP route definitions |
| openclaw | entry | has entry points, only outbound calls |
| ssh/id_rsa | api | has HTTP route definitions |
| tools | entry | only outbound calls |
| ts | api | has HTTP route definitions |
| txt | api | has HTTP route definitions |

## Detected Clusters

- src: 40 members, cohesion 0.7333333333333333, top nodes: createGatewayServer, MockGatewayZaloClient, requireBearerToken, loadGatewayConfig, actionResponse
- src: 37 members, cohesion 0.6746987951807228, top nodes: log, hasStoredCredentials, getCredentialsPath, loginWithCredentials, main
- src: 37 members, cohesion 0.6833333333333333, top nodes: startListener, monitorZaloClawProvider, #processNext, handleGroupEvent, removePendingRequest
- src: 32 members, cohesion 0.72, top nodes: dispatch, getZaloClawConfig, updateZaloClawConfig, sendSticker, addToDenyFrom
- src: 30 members, cohesion 0.8, top nodes: error, json, checkOutbound, isRecord, requiredString
- src: 28 members, cohesion 0.5277777777777778, top nodes: getApi, getGroupInfo, loadGroupMemberIndex, sendLink, getGroupMembers
- src: 27 members, cohesion 0.8484848484848485, top nodes: createHermesBridgeServer, process, gatewayJson, loadHermesBridgeConfig, startBridge
- legacy: 26 members, cohesion 0.6326530612244898, top nodes: processMessage, deliverZaloClawReply, addReaction, logVerbose, isUserDeniedInGroup
- hermes-plugin: 25 members, cohesion 0.8205128205128205, top nodes: error, policyResponse, policyListResponse, _handle_sse_record, json
- src: 24 members, cohesion 0.6808510638297872, top nodes: downloadImageFromUrl, update, downloadFileFromUrl, add, downloadInboundMedia
- src: 19 members, cohesion 0.5263157894736842, top nodes: sendMessageZaloClaw, sendMessage, checkInjection, resolveOutboundMentions, uploadAndSendLocalImage
- legacy: 14 members, cohesion 0.8666666666666667, top nodes: resolveZaloClawAccountSync, promptZaloClawAllowFrom, listZaloClawAccountIds, mergeZaloClawAccountConfig, resolveZaloClawAccount

## Routes

-  /etc/passwd — ``
-  /root/.ssh/id_rsa — ``
-  /tmp/../etc/passwd — ``
-  /proc/self/environ — ``
-  /var/run/secrets/kubernetes.io — ``
-  /login/qr/start — ``
-  /login/qr/status — ``
-  /home/user/file.txt — ``
-  /tmp/image.jpg — ``
-  /home/user/project/file.ts — ``
-  /root/.config — ``
-  /home/user/test — ``

## Architecture Working Rules

- Treat high fan-in symbols as risky change points.
- Route/API changes must preserve shared auth, error handling, payload semantics, and tests.
- Worker/task changes must identify lifecycle edges: enqueue, execute, success, failure, rollback, retry.
- If graph output and source disagree, source plus tests win.
