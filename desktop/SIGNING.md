# Signing the Windows installer

An unsigned installer makes Windows SmartScreen warn "unknown publisher". Signing needs a certificate issued to you or your company; nobody can generate one that Windows trusts for you.

## Options

| Option | Cost | SmartScreen |
|---|---|---|
| Azure Trusted Signing (Microsoft) | monthly subscription | trusted quickly; needs an identity check |
| EV code-signing certificate (hardware token or cloud HSM) | yearly | trusted immediately |
| OV code-signing certificate (.pfx) | yearly | warning fades as the app builds reputation |
| SignPath Foundation | free, open-source projects only | needs a public repository |

## Building signed

OV certificate as a .pfx file (keep the file and password out of git):

```bash
set CSC_LINK=C:\secure\chart-terminal.pfx
set CSC_KEY_PASSWORD=your-password
npm --prefix desktop run dist:win:signed
```

`dist:win:signed` stops first if no certificate is configured (`sign-check.mjs`), so an unsigned installer is never mistaken for a signed one. electron-builder signs the app, the uninstaller and the installer automatically when `CSC_LINK` is set.

Azure Trusted Signing: set `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, and add `win.azureSignOptions` (endpoint, account name, certificate profile name) to `package.json`.

## Check the result

```bash
powershell -c "Get-AuthenticodeSignature 'desktop\release\Chart Terminal Setup 0.1.0.exe' | Format-List Status, SignerCertificate"
```

`Status : Valid` means it is signed and trusted.
