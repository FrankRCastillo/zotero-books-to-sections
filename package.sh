#!/bin/bash

set -e

user="FrankRCastillo"
repo="zotero-books-to-sections"
file="$repo.xpi"
vers="0.1.0"

echo -n "Deleting old XPI file..."
rm -rf ../$file
echo "Done"

echo "Creating new XPI file..."
zip -r ../$file *

echo -n "Getting release asset ID..."
jq_cmd=".assets[] | select(.name == \"$file\") | .id"
asset=$(gh release view $vers --repo $user/$repo --json assets --jq "$jq_cmd")
echo "Done. Asset ID: $asset"

echo -n "Loading latest release file..."
gh release upload $vers ../$file --repo $user/$repo --clobber > /dev/null && echo "Done" || echo "Error"

echo "Updating the tag to the latest commit..."
git tag -f $version
git push origin $version --force
echo "Done updating tag."
