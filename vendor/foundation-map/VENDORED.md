# Vendored placeholder

These files are a plain copy of `~/openyap-foundation-map` (the shared engine repo).

They are here as a copy only because the GitHub repo did not exist yet at wire-up time.
Once `github.com/dyap123/openyap-foundation-map` is pushed, replace this directory with the
real submodule so the two apps can never drift:

```bash
cd ~/look-ahead
rm -rf vendor/foundation-map
git submodule add https://github.com/dyap123/openyap-foundation-map vendor/foundation-map
```

Until then, re-sync after any engine change with:

```bash
cp ~/openyap-foundation-map/foundation-map.js ~/openyap-foundation-map/foundation_geo.js \
   ~/look-ahead/vendor/foundation-map/
```
