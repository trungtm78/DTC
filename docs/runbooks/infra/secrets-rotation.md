# Secrets and their rotation

Files under `infra/` hold `secret://` references only. A value (password, token, key, or a URL with credentials) in any
`infra/` file fails `npm run infra:check`. `infra/secrets/references.json` lists each reference with its owner and its
rotation period in days, at most 90.

## Rotate a secret

1. Create the new value in the secret store under the same reference, as a new version.
2. Deploy consumers so they read the new version (the application reads the reference at start; restart the pods in the
   canary order of the production pipeline).
3. Verify the consumers work with the new version, then disable the old version and, after one release, delete it.
4. Record the date next to the reference in the owner's rotation log.

## A leaked secret

Rotate immediately, do not wait for the schedule. Rotate dependent secrets (a leaked database credential is also a
reason to review the session and token signing keys). Open a security incident and note which records the secret could
reach.

## License signing key

`secret://<env>/license-signing-key` is rotated with the key-rotation procedure of the licensing module (the old public
key stays published until every license signed with it has expired).
