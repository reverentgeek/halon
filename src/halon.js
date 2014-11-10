/* global require, module */
/* jshint -W098 */
( function( root, factory ) {
	if ( typeof define === "function" && define.amd ) {
		// AMD. Register as an anonymous module.
		define( [ "machina", "lodash", "when", "URIjs", "URITemplate" ], factory );
	} else if ( typeof module === "object" && module.exports ) {
		// Node, or CommonJS-Like environments
		module.exports = factory(
			require( "machina" ),
			require( "lodash" ),
			require( "when" ),
			require( "URIjs" ),
			require( "URIjs/src/URITemplate" )
		);
	} else {
		throw new Error( "Sorry - halon only supports AMD or CommonJS module environments." );
	}
}( this, function( machina, _, when, URI, URITemplate ) {

	var _defaultAdapter;

	// special case extend for resource objects only
	// NOTE: intentionally not supporting arrays, since
	// they are not a current use case for this need
	function deepExtend( target ) {
		_.each( Array.prototype.slice.call( arguments, 1 ), function( source ) {
			_.each( source, function( val, key ) {
				if ( typeof val === "object" ) {
					target[ key ] = target[ key ] || {};
					deepExtend( target[ key ], val );
				} else {
					target[ key ] = val;
				}
			} );
		} );
		return target;
	}

	function invokeResource( fsm, key, data ) {
		data = data || {};
		return when.promise( function( resolve, reject ) {
			fsm.handle(
				"invoke.resource",
				this,
				key,
				data,
				resolve,
				reject
			);
		}.bind( this ) );
	}

	function processEmbedded( response ) {
		if ( response._embedded ) {
			_.each( response._embedded, function( value, key ) {
				processEmbedded( value );
				response[ key ] = value;
			} );
			delete response._embedded;
		}
		return response;
	}

	function processLinks( options, fsm ) {
		var actions = options._actions = {};
		_.each( options._links, function( linkDef, relKey ) {
			var splitKey = relKey.split( ":" );
			var rel = relKey;
			var target = actions;
			if ( splitKey.length === 2 ) {
				target = actions[ splitKey[ 0 ] ] = ( actions[ splitKey[ 0 ] ] || {} );
				rel = splitKey[ 1 ];
			}
			target[ rel ] = invokeResource.bind( options, fsm, relKey );
		} );
		return options;
	}

	function processKnownOptions( knownOptions ) {
		var x = _.reduce( knownOptions, function( memo, rels, resource ) {
			rels.forEach( function( rel ) {
				memo._links[ resource + ":" + rel ] = {};
			} );
			return memo;
		}, { _links: {} } );
		return x;
	}

	var HalonClientFsm = machina.Fsm.extend( {

		initialize: function( options ) {
			_.extend( this.client, processLinks(
				processKnownOptions( options.knownOptions ),
				this
			) );
		},

		states: {
			uninitialized: {
				"start": "initializing",
				"invoke.resource": function() {
					this.deferUntilTransition( "ready" );
				}
			},
			initializing: {
				_onEnter: function() {
					this.adapter( { href: this.root, method: "OPTIONS" }, { headers: { Accept: "application/hal.v" + this.version + "+json" } } )
						.then(
							this.handle.bind( this, "root.loaded" ), function( err ) {
								console.warn( err );
							}
					);
				},
				"root.loaded": function( options ) {
					deepExtend( this.client, processLinks( options, this ) );
					this.transition( "ready" );
				},
				"invoke.resource": function() {
					this.deferUntilTransition( "ready" );
				}
			},
			ready: {
				"invoke.resource": function( resource, rel, data, success, err ) {
					var resourceDef = resource._links[ rel ];
					if ( !resourceDef ) {
						throw new Error( "No link definition for rel '" + rel + "'" );
					}
					if ( resourceDef.templated ) {
						resourceDef = _.extend( {}, resourceDef, { href: URI.expand( resourceDef.href, data ).href() } );
					}
					this.adapter( resourceDef, { data: data, headers: { Accept: "application/hal.v" + this.version + "+json" } } )
						.then( function( response ) {
							return when.promise( function( resolve, reject ) {
								if ( !response ) {
									var err = new Error( "Empty response for " + rel );
									err.resourceDef = resourceDef;
									reject( err );
								}
								resolve( processEmbedded( processLinks( response, this ) ) );
							}.bind( this ) );
						}.bind( this ) )
						.then( success, err );
				}
			}
		}
	} );

	var defaults = {
		version: 1,
		knownOptions: {},
		adapter: _defaultAdapter
	};

	var halonFactory = function( options ) {
		var client = function halonInstance() {
			var args = Array.prototype.slice.call( arguments, 0 );
			return when.all( args );
		};
		options = _.defaults( options, defaults );
		options.client = client;

		var fsm = client.fsm = new HalonClientFsm( options );

		client.onReady = function( cb ) {
			if ( fsm.state === "ready" ) {
				cb( client );
			} else {
				var listener;
				listener = fsm.on( "transition", function( data ) {
					if ( data.toState === "ready" ) {
						listener.off();
						cb( client );
					}
				}.bind( this ) );
			}
			return client;
		};

		client.start = function() {
			fsm.handle( "start" );
		};

		if ( !options.doNotStart ) {
			setTimeout( function() {
				client.start();
			}, 0 );
		}

		return client;
	};

	halonFactory.defaultAdapter = function( adapter ) {
		_defaultAdapter = adapter;
		return halonFactory;
	};

	halonFactory.jQueryAdapter = function( $ ) {
		return function( link, options ) {
			return $.ajax( {
				url: link.href,
				type: link.method,
				headers: options.headers,
				dataType: "json",
				data: options.data
			} );
		};
	};

	return halonFactory;

} ));