#!/bin/bash

set -e

file="zotero-books-to-sections.xpi"

echo -n "Deleting old XPI file..."
rm -rf ../$file
echo "Done"

echo "Creating new XPI file..."
zip -r ../$file *
echo "File created in $(readlink -f ../$file)"
