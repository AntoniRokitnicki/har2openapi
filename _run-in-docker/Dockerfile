FROM node:17
RUN git clone https://github.com/dcarr178/har2openapi
WORKDIR har2openapi
RUN npm install
CMD cp /mylocal/*.* /har2openapi && node index.js examples a.har && yes | rm -rf /mylocal/output && yes | cp -r /har2openapi/output /mylocal/output
