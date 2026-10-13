# Install and find_package(cantus) export rules. Included last from the top-level CMakeLists, so
# every target and every module directory is already known.

include(CMakePackageConfigHelpers)

set(CANTUS_CMAKE_CONFIG_DESTINATION ${CMAKE_INSTALL_LIBDIR}/cmake/cantus)

set(_cantus_export_targets cantus cantus_ops)
if(CANTUS_BUILD_SHARED)
  list(APPEND _cantus_export_targets cantus_shared)
endif()

install(TARGETS ${_cantus_export_targets}
  EXPORT cantusTargets
  ARCHIVE DESTINATION ${CMAKE_INSTALL_LIBDIR}
  LIBRARY DESTINATION ${CMAKE_INSTALL_LIBDIR}
  RUNTIME DESTINATION ${CMAKE_INSTALL_BINDIR}
  INCLUDES DESTINATION ${CMAKE_INSTALL_INCLUDEDIR})

# Public headers. In the source tree core/limits.h includes each module's generated
# src/**/limits.gen.h by relative path; the installed copy has those inlined instead.
install(DIRECTORY ${PROJECT_SOURCE_DIR}/include/cantus
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}
  FILES_MATCHING PATTERN "*.h"
  PATTERN "limits.h" EXCLUDE)

set(_cantus_limits_in ${PROJECT_SOURCE_DIR}/include/cantus/core/limits.h)
file(STRINGS ${_cantus_limits_in} _cantus_limits_lines)
set(_cantus_limits_out "")
set(_cantus_limits_deps ${_cantus_limits_in})
foreach(_cantus_line IN LISTS _cantus_limits_lines)
  if(_cantus_line MATCHES "^#include \"\\.\\./\\.\\./\\.\\./(src/[^\"]+)\"$")
    set(_cantus_gen ${PROJECT_SOURCE_DIR}/${CMAKE_MATCH_1})
    file(READ ${_cantus_gen} _cantus_gen_text)
    string(APPEND _cantus_limits_out "${_cantus_gen_text}")
    list(APPEND _cantus_limits_deps ${_cantus_gen})
  else()
    string(APPEND _cantus_limits_out "${_cantus_line}\n")
  endif()
endforeach()
file(GENERATE OUTPUT ${CMAKE_CURRENT_BINARY_DIR}/install-include/cantus/core/limits.h
     CONTENT "${_cantus_limits_out}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${_cantus_limits_deps})
install(FILES ${CMAKE_CURRENT_BINARY_DIR}/install-include/cantus/core/limits.h
  DESTINATION ${CMAKE_INSTALL_INCLUDEDIR}/cantus/core)

install(EXPORT cantusTargets
  FILE cantusTargets.cmake
  NAMESPACE cantus::
  DESTINATION ${CANTUS_CMAKE_CONFIG_DESTINATION})

set(CANTUS_CONFIG_WITH_SHARED ${CANTUS_BUILD_SHARED})
configure_package_config_file(
  ${PROJECT_SOURCE_DIR}/cmake/cantusConfig.cmake.in
  ${CMAKE_CURRENT_BINARY_DIR}/cantusConfig.cmake
  INSTALL_DESTINATION ${CANTUS_CMAKE_CONFIG_DESTINATION})

# A C++ API change is a SemVer major change; within a major, a newer build satisfies an older one.
write_basic_package_version_file(
  ${CMAKE_CURRENT_BINARY_DIR}/cantusConfigVersion.cmake
  VERSION ${PROJECT_VERSION}
  COMPATIBILITY SameMajorVersion)

install(FILES
  ${CMAKE_CURRENT_BINARY_DIR}/cantusConfig.cmake
  ${CMAKE_CURRENT_BINARY_DIR}/cantusConfigVersion.cmake
  DESTINATION ${CANTUS_CMAKE_CONFIG_DESTINATION})
