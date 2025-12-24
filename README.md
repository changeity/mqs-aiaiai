# Marquis AI & Automation Opportunity Explorer (v1)

This is a **static** (no-backend) web app built from your structured dataset.

## How to use
### Fastest
1. Unzip the folder
2. Double-click `index.html`

This works because the dataset is embedded inside the HTML (no server required).

### Optional (recommended for hosting)
Host the folder on an internal web server / SharePoint / S3 / Cloudflare Pages.

## What it does
- CEO-friendly overview explaining **Automation vs AI** and **Local vs Vendor**
- Clickable **one-page map** (Foundations → Domains → Opportunities)
- Full **portfolio explorer** with filters + search
- **Mindmap** view (Domains → Opportunities)
- Workflow intervention maps (step-by-step swimlanes only when steps are explicitly stated)
- Foundations + local/self-hostable reference sections pulled from the dataset

## Update the dataset
Replace `data.json` and re-embed it into `index.html` (or rebuild) if you want the “double-click works” behavior.
If you’re hosting, you can remove the embedded block and load `data.json` normally.

## Notes
- The UI never invents facts. If a field is missing in the dataset, it shows “Not stated in source.”
- “Patterns” and “Local/Vendor hint” are **derived from keywords** present in the dataset fields and are explicitly labeled as derived.
