# Development workflow

- Keep only two long-lived branches: `main` for completed work and `develop` for integration.
- Implement each feature on a temporary branch created from the latest `develop`.
- Verify and commit each completed feature, merge it into `develop`, and then merge the verified result into `main` without asking for separate merge approval.
- Delete completed feature branches locally and remotely after confirming their commits are included in `main`. Preserve any branch containing unmerged work.
- Keep `develop` synchronized with `main` after completing a feature. Deployments remain manual and separate from merging.
- Preserve the ignored `archieve/` folder; it contains the original project files.
