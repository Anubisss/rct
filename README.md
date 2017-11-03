# RCT (Random Capital Tickers)
RCT is a simple scheduled AWS Lambda function (managed via Serverless) which generates a no-design HTML file and puts it to an AWS S3 bucket.
It generator filters stocks and ETFs and displays their tickers in lists which is useful to search on Finviz screener.

Live: http://rct.anuka.me/

### Note
This is not a Random Capital product. Created for fun and personal usage.

Original list: http://www.randomcapital.hu/ik

### Deployment
1. ```npm install```
2. ```./node_modules/.bin/serverless deploy --host-s3-bucket-name S3_BUCKET_NAME```

Check the serverless.yml file for further options.

### License
The MIT License (MIT)
