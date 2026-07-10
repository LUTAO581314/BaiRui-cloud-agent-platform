# License Package

This package implements license generation, signing, parsing, and validation
helpers used by the BaiRui platform and customer deployment flow.

License payload should include:

- license id;
- organization id;
- plan;
- features;
- limits;
- issue time;
- expiry time;
- deployment mode;
- signature.

License payload must not include secrets, API keys, connector tokens, customer
business data, prompts, chat history, files, or Obsidian note bodies.

## Generate A Development License

```powershell
$env:BAIRUI_LICENSE_SECRET="dev-secret"
npm run license:generate -- --license-id=lic_dev --organization-id=org_dev --plan=starter --out=dist/bairui-license.json
```

The generated file can be copied into a customer deployment and verified with
the same `BAIRUI_LICENSE_SECRET`.

