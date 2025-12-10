const fs = require('fs')
const path = require('path')
const spawn = require('child_process').spawn
const through2 = require('through2')
const tmp = require('tmp')
const os = require('os')

const section = ['\\section{', '\\subsection{', '\\subsubsection{']
const extensions = {
  '.cc': 'C++',
  '.cpp': 'C++',
  '.hpp': 'C++',
  '.c': 'C',
  '.java': 'Java',
  '.py': 'Python',
  '.tex': 'Tex',
  '.go': 'Golang'
}

function escapeLatex(text) {
  return text
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/&/g, '\\&')
    .replace(/\^/g, '\\^{}')
    .replace(/~/g, '\\~{}')
    .replace(/%/g, '\\%')
}

function walkToStream(_path, depth, output) {
  // multicol package keeps all content in memory, so avoid buffering here
  depth = Math.min(depth, section.length - 1)
  fs.readdirSync(_path).forEach(function (file) {
    if (file.startsWith('.')) {
      return // hidden directory
    }
    const f = path.resolve(_path, file)
    const stat = fs.lstatSync(f)
    if (stat.isDirectory()) {
      const title = '\\text{ ' + escapeLatex(file) + ' }'
      output.write('\n' + section[depth] + title + '}\n')
      walkToStream(f, depth + 1, output)
    } else if (path.extname(f) in extensions) {
      const title = '\\text{ ' + escapeLatex(file.split('.')[0]) + ' }'
      output.write('\n' + section[depth] + title + '}\n')
      if (path.extname(f) !== '.tex') {
        output.write(`\\begin{lstlisting}[language=${extensions[path.extname(f)]}]\n`)
        output.write(fs.readFileSync(f, 'utf8'))
        output.write('\\end{lstlisting}\n')
      } else {
        output.write(fs.readFileSync(f, 'utf8'))
      }
    }
  })
}

/**
 * pdf must be generated twice in order to generate the table of contents.
 * According to some tests, in windows it must be generated 3 times.
 * */
function genpdf(ans, texPath, tmpobj, iter) {
  const tex = spawn('pdflatex', [
    '-interaction=nonstopmode',
    texPath
  ], {
    cwd: tmpobj.name,
    env: process.env
  })

  tex.on('error', function (err) {
    console.error(err)
  })

  tex.on('exit', function (code, signal) {
    const outputFile = texPath.split('.')[0] + '.pdf'
    fs.access(outputFile, function (err) {
      if (err) {
        return console.error('Not generated ' + code + ' : ' + signal)
      }
      if (iter === 0) {
        const s = fs.createReadStream(outputFile)
        s.pipe(ans)
        s.on('close', function () {
          tmpobj.removeCallback()
        })
      } else {
        genpdf(ans, texPath, tmpobj, iter - 1)
      }
    })
  })
}

function pdflatexFromPath(texPath, tmpobj) {
  const ans = through2()
  ans.readable = true
  const iters = process.platform === 'win32' ? 2 : 1
  genpdf(ans, texPath, tmpobj, iters)
  return ans
}

function normalizeUnixStyle(currentPath) {
  if (os.type() === 'Windows_NT') {
    return currentPath.replace(/\\/g, '/')
  }
  return currentPath
}

function templateParameter(parameter) {
  return `\${${parameter}}`
}

module.exports = function (_path, options) {
  options.output = options.output || './notebook.pdf'
  options.author = options.author || ''
  options.initials = options.initials || ''
  options.orientation = options.orientation || 'portrait'

  if (!options.size.endsWith('pt')) options.size += 'pt'
  if (options.image) {
    options.image = normalizeUnixStyle(path.resolve(options.image))
    options.image = '\\centering{\\includegraphics[width=3.5cm]{' + options.image + '}}'
  } else {
    options.image = ''
  }

  let multicolsBegin = ''
  let multicolsEnd = ''
  if (parseInt(options.columns) > 1) {
    multicolsBegin = `\\begin{multicols}{${options.columns}}`
    multicolsEnd = '\\end{multicols}\n'
  }

  const tmpobj = tmp.dirSync({ unsafeCleanup: true })
  const texPath = path.join(tmpobj.name, '_notebook.tex')
  const texOutput = fs.createWriteStream(texPath, { encoding: 'utf8' })

  let template = fs.readFileSync(path.join(__dirname, 'template_header.tex')).toString()
  template = template
    .replace(templateParameter('author'), options.author)
    .replace(templateParameter('initials'), options.initials)
    .replace(templateParameter('fontSize'), options.size)
    .replace(templateParameter('multicolsBegin'), multicolsBegin)
    .replace(templateParameter('paper'), options.paper)
    .replace(templateParameter('orientation'), options.orientation)
    .replace(templateParameter('image'), options.image)

  texOutput.write(template)
  walkToStream(_path, 0, texOutput)
  texOutput.write(multicolsEnd)
  texOutput.end('\\end{document}')

  texOutput.on('error', function (err) {
    console.error('Failed to write tex file', err)
  })

  texOutput.on('close', function () {
    pdflatexFromPath(texPath, tmpobj).pipe(fs.createWriteStream(options.output))
  })
}
