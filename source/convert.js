/**
 *
 * Converts all the preprocessor blending functions to some standard blending function glslify goodness.
 *
 */

var fsUtil = require( 'fs' );
var pathUtil = require( 'path' );
var glsl = fsUtil.readFileSync( './ThanksPhotoshopMathFP.glsl', 'utf-8' );


var mapModes = { // map these modes to another mode.
    'BlendLinearDodgef':'BlendAddf',
    'BlendLinearBurnf':'BlendSubstractf',
    'BlendLighten':'BlendLightenf',
    'BlendDarken':'BlendDarkenf',
    'BlendLinearDodge':'BlendAdd',
    'BlendLinearBurn':'BlendSubstract'
};

// ignore from standard handling.
// blend is inlined, opacity is exported as seperate function for each mode
var ignoreModes = {
    'Blend': true,
    'BlendOpacity':true
};

var matches = glsl.match( /#define Blend.+\n/g ); // match preprocessor line.
var ppLine;
var chomp,c,b,name,sig,impl,entry;
var entryMap = {};

for( var i = 0; i<matches.length; i++ )
{
    ppLine = matches[i].toString();

    chomp = '';
    b = 0;
    entry = {
        name: null,
        impl: null
    };
    for( var j = 0; j<ppLine.length;j++ ){
        c = ppLine[ j ];
        if( c === '(' && b === 0 ){
            b++;
            entry.name = chomp.replace( '#define ', '' );
        }
        if( c === ')' && b === 1){
            b++;
            entry.impl = '';
        }else
        if( b > 1 ){
            entry.impl+= c;
        }

        chomp += c;
    }
    if( b > 0 ){
        entry.impl = entry.impl.replace( /[\t\n ]/g, '');

        if( entry.impl[0] == '(' ){ // some clean up of () wrappers
            entry.impl = entry.impl.slice( 1, -1 );
        }

    }

    // null entries will be mapped to another most likely.
    if( entry.name !== null ){
        if( entry.name.slice( -1 ) === 'f' ){
            entry.float = true;
        }else{
            entry.float = false;
        }
        entryMap[ entry.name ] = entry;
    }
}

// map others..
for( var map in mapModes ){
    entry = {
        name: map,
        impl: entryMap[ mapModes[ map] ].impl,
        implMod: null, // assigned below - final impl after mod
        //mapTo: entryMap[ mapModes[ map ] ],
        float: entryMap[ mapModes[ map] ].float,
        comments: 'Note : Same implementation as ' + entryMap[ mapModes[ map]].name,
        opacityBlend: false // see below

    };

    entryMap[ entry.name ] = entry;
}


// add function names &
// add opacity blend modes.
// we can't pass functions so we'll export a separate function for each mode.
// #define BlendOpacity(base, blend, F, O) 	(F(base, blend) * O + blend * (1.0 - O))

var entryO;
var opacityImpl = '(F(base, blend) * opacity + blend * (1.0 - opacity))';
for( name in entryMap )
{
    entry = entryMap[ name ];

    // function name
    entry.functionName = name[0].toLowerCase() + name.slice(1);



    // opacity blend modes.
    if( !entry.float && !ignoreModes[ entry.name ] )
    {
        // TODO : Create float modes for opacity?

        entryO = {
            name: name + 'o',
            opacityBlend: true,
            impl: opacityImpl.replace( 'F', entry.name ),
            implMod: null,
            float: false,
            functionName: name[0].toLowerCase() + name.slice( 1 ) + 'o'
        };

        entryMap[ entryO.name ] = entryO;
    }

}

// finalise

for( name in entryMap )
{
    entry = entryMap[ name ];
    // generate file name

    chomp = '';

    for( j = 0; j<name.length; j++ ) {
        c = name[ j ];
        if(c.match( /[A-Z]/ ) && j > 0){
            chomp += '-' + c.toLowerCase();
        }else{
            chomp += c.toLowerCase();
        }
    }
    var mode = chomp;

    if( chomp[ chomp.length-1 ] === 'f' ){
        mode = chomp.slice( 0,-1 );
        chomp = chomp.slice( 0,-1 ) + '-f';
    }else
    if( chomp[ chomp.length-1 ] === 'o' ){
        mode = chomp.slice( 0,-1 );
        chomp = chomp.slice( 0,-1 ) + '-o';
    }

    // mode
    // remove the blend- bit.. so names become e.g. 'blend/hard-light.glsl'
    entry.filename = chomp.replace( 'blend-', '' );
    entry.mode = mode.replace( 'blend-', '' );
}

// determine dependencies..

for( name in entryMap )
{
    entry = entryMap[ name ];

    // dependencies..
    entry.deps = [];

    var deps = [];
    var d;
    for( d in entryMap ) {
        deps.push( d + '[\\(\\)]' );
    }

    matches = entry.impl.match( new RegExp( deps.join('|'), 'g' ) );

    entry.implMod = entry.impl;
    if( matches ){
        var andBlend = false;

        for( j = 0; j<matches.length; j++ ){
            d = entryMap[ matches[j].slice(0,-1) ];

            // replace the impl with our deps correct function names
            if(d.name === 'Blend'){
                andBlend = true; // handle last otherwise we may overwrite
            }else{
                entry.implMod = entry.implMod.replace(d.name, d.functionName);

                // Don't push Blend function - we are inlining this method.
                entry.deps.push( d );
            }
        }
        if( andBlend ){ // probably removing blend anyway
            entry.inlineBlend = true; // we will inline the blend method instead of requiring it.
            entry.implMod = entry.implMod.replace('Blend', 'blend');
        }
    }
}

var content;
var allContent = '';

for( name in entryMap )
{
    entry = entryMap[ name ];

    if( !ignoreModes[ name ] )
    {
        content = '\n';

        // handle changes in filename..
        var file,dep;
        for( j = 0; j<entry.deps.length; j++ ) {

            dep = entry.deps[j];

            if( dep.mode === entry.mode ){
                file = '.';
            }else{
                file = '../' + dep.mode;
            }

            if( dep.float ){
                file += '/f';
            }else
            if( dep.opacityBlend ){
                file += '/o';
            }else
            if( dep.mode == entry.mode ){
                file += '/';
            }

            content += '#pragma glslify: ' + dep.functionName + ' = require(' + file + ')\n';
        }

        if( entry.deps.length ){
            content += '\n';
        }

        if( entry.float ){
            content += 'float ' + entry.functionName + '(float base, float blend) {\n';
        }else
        if( entry.opacityBlend ){
            content += 'vec3 ' + entry.functionName + '(vec3 base, vec3 blend, float opacity) {\n';
        }else{
            content += 'vec3 ' + entry.functionName + '(vec3 base, vec3 blend) {\n';
        }

        if( entry.comments ){
            content += '\t// ' + entry.comments + '\n';
        }

        // could modify these implementations so similar to
        // https://github.com/mattdesl/glsl-blend-soft-light'
        // but this will do for now.

        if( entry.inlineBlend ){
            // blend function..
            //#define Blend(base, blend, funcf) 		vec3(funcf(base.r, blend.r), funcf(base.g, blend.g), funcf(base.b, blend.b))
            // this works for all functions that require it
            var inline = entryMap[ 'Blend' ].impl;
            content += '\t' + 'return ' + inline.replace( /funcf/g, entry.deps[0].functionName ) + ';';
            content += '\n';

        }else{
            content += '\treturn ' + entry.implMod + ';\n';
        }
        content += '}\n\n';

        content += '#pragma glslify: export(' + entry.functionName + ')';

    }

    var message = [
        entry.name
        //'',
        //'Generated using the ../source/convert.js script.'
    ];

    var messageString = '/**\n *\n';

     for( i = 0; i<message.length; i++ )
     {
         messageString += ' * ' + message[i] + '\n';
     }

    messageString += ' *\n */\n';

    content = messageString + content;

    if( !ignoreModes[ entry.name ] )
    {
        allContent += content + '\n\n\n';

        // new file structure.
        // ../blend/blendMode/index.glsl   // standard mode
        // ../blend/blendMode/o.glsl       // opacity mode
        // ../blend/blendMode/f.glsl       // float mode

        if( !fsUtil.existsSync('../blend' ) ){
            fsUtil.mkdirSync( '../blend' );
        }
        if( !fsUtil.existsSync('../blend/' + entry.mode ) ){
            fsUtil.mkdirSync( '../blend/' + entry.mode );
        }

        if( entry.float ){
            fsUtil.writeFileSync( '../blend/' + entry.mode + '/f.glsl', content );
        }else
        if( entry.opacityBlend ){
            fsUtil.writeFileSync( '../blend/' + entry.mode + '/o.glsl', content );
        }else{
            fsUtil.writeFileSync( '../blend/' + entry.mode + '/index.glsl', content );
        }
    }

}

//
fsUtil.writeFileSync( 'debug.glsl', allContent );

content = '';
// Write a require test file.
for( name in entryMap )
{
    entry = entryMap[ name ];

    if( !ignoreModes[ name ] ) {
        content += '#pragma glslify: ' + entry.name + ' = require(../blend/' + entry.filename + ')';
        content += '\n';
    }

}

fsUtil.writeFileSync( 'require-test.glsl', content );