module.exports = function( adapterStub ) {
	var junk = [];
	var req = {
	};
	return function request( opts, cb ) {
		request.state = req;
		adapterStub( { href: opts.url }, opts )
			.then( function( res ) {
				cb( null, null, JSON.stringify( res ) );
			} );
		return req;
	};
};