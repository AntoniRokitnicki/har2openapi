rem docker build --progress=plain --no-cache -t foo .
docker build --progress=plain -t har-to-openapi .
docker run --rm -v %cd%:/mylocal har-to-openapi
