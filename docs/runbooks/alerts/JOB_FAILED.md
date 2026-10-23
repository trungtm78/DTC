# JOB_FAILED

**Owner:** platform-oncall · **Severity:** warning · **Rule:** `alerts/rules/JOB_FAILED.json`

## What it means

One run of a scheduled job ended in an error (the error class, never its message, is in the alert context). The next run is tried on schedule.

## What to do

1. Read `job_runs_total{job,outcome="failed"}` and the error class to see which job and why.
2. Run the job once by hand (`npm run jobs:run -- <job>`) after fixing the cause.
3. A job that fails every run needs a ticket: the data it maintains is going stale.
