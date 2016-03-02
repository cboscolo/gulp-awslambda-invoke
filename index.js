'use strict';
var gutil = require('gulp-util');
var through = require('through2');
var extend = require('xtend');
var path = require('path');
var fs = require('fs');

const PLUGIN_NAME = 'gulp-awslambda-invoke';

var DEFAULT_OPTIONS = {
    'PackageFolder': './',
    'Handler': 'handler',
    'FileName': 'index.js',
    'Event': 'event.json',
    'ClientContext': 'client_context.json',
    'Identity': 'identity.json'
};

var makeErr = function(message) {
    return new gutil.PluginError('PLUGIN_NAME', message);
};

module.exports = function(options) {
    options = extend(DEFAULT_OPTIONS, options);

    var fileToRequire;
    var clientContext = null;


    //since clientContext should be optional, skip if doesn't exist
    try {
        clientContext = JSON.parse(fs.readFileSync(path.resolve(options.ClientContext), "utf8"));
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }

    var identity = null;
    //since identity should be optional, skip if doesn't exist
    try {
        identity = JSON.parse(fs.readFileSync(path.resolve(options.Identity), "utf8"));
    } catch (e) {
        if (e.code !== 'ENOENT') {
            throw e;
        }
    }

    var cwd;
    if (options.PackageFolder) {
        cwd = process.cwd();
        process.chdir(path.resolve(options.PackageFolder));
    }

    var transform = function(file, enc, cb) {
        if (file.isNull()) {
            return cb(null, file);
        }
        if (file.isStream()) {
            return cb(makeErr('Streaming is not supported'));
        }
        if (!fileToRequire) {
            fileToRequire = file;
        }
        cb();
    };

    var invoke = function(cb) {

        if (!fileToRequire) {
            return cb(makeErr('No code.' ));
        }

        if (fileToRequire && fileToRequire.path.slice(-3) !== '.js') {
            return cb(makeErr('Provided file must have .js extension'));
        }

        gutil.log('Invoking Lambda function "' + options.Handler + '"...');

        var stream = this;

        var context = {
            done: function (error, result) {
                if (error === null || typeof(error) === 'undefined') {
                    context.succeed(result);
                } else {
                    context.fail(error);
                }
            },
            succeed: function (result) {
                if (cwd) {
                    process.chdir(cwd);
                }

                var msg = (typeof(result) === 'object') ? JSON.stringify(result) : result;
                gutil.log( 'AWS Lambda success: ' + ((typeof(result) !== 'undefined') ? msg : "Successful!"));

                stream.push(fileToRequire);
            },
            fail: function (error) {
                if (cwd) {
                    process.chdir(cwd);
                }
                
                var msg = (typeof(error) === 'object') ? JSON.stringify(error) : error;

                gutil.log( 'AWS Lambda fail: ' + ((typeof(error) !== 'undefined') ? msg : "Error not provided."));

                stream.emit('error', new gutil.PluginError(PLUGIN_NAME, msg));
            },
            awsRequestId: 'LAMBDA_INVOKE',
            logStreamName: 'LAMBDA_INVOKE',
            clientContext: clientContext,
            identity: identity
        };

        var event = {};

        try {
            event = JSON.parse(fs.readFileSync(path.resolve(options.Event), "utf8"));
        } catch (e) {
            if (e.code !== 'ENOENT') {
                throw e;
            }
        }

        var lambda = require(fileToRequire.path);

        if ( typeof(lambda[options.Handler.split('.').pop()]) === 'function' ) {
            lambda[options.Handler.split('.').pop()](event, context);
        } else {
            stream.emit('error', new gutil.PluginError(PLUGIN_NAME, 'handler not a function: ' + options.Handler ));
        }
    }

    return through.obj(transform, invoke);

};
