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
echo "File created in $(readlink -f ../$file)"
